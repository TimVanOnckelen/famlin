import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pkg from '../../package.json' with { type: 'json' };
import { prisma } from '../db.js';
import { createUserToken, getDiscovery, exchangeOidcCode, OidcError, invalidateSessionCache } from '../plugins/auth.js';
import { getOidcSettings, getAllSettings } from '../services/settings.js';
import { getValidInvite, consumeInvite } from '../services/invites.js';
import { completeOidcLogin } from '../services/oidcLogin.js';
import { createOidcHandoff, consumeOidcHandoff } from '../services/oidcHandoff.js';
import { getT } from '../i18n/index.js';
import { sanitizeUser } from '../services/users.js';
import {
  loginBodySchema,
  oidcExchangeBodySchema,
  oidcMobileHandoffBodySchema,
  passwordLoginBodySchema,
  registerBodySchema,
  setupBodySchema,
  changePasswordBodySchema,
  resetPasswordBodySchema,
  updateUserBodySchema,
} from '../types.js';

// Never a valid bcrypt match — used so a login with an unknown email still
// pays the cost of a bcrypt.compare, instead of returning immediately, so
// timing doesn't reveal whether the email exists.
const DUMMY_PASSWORD_HASH = await bcrypt.hash(crypto.randomUUID(), 12);

// Arbitrary fixed key for a Postgres advisory lock — only used to serialize
// concurrent POST /setup calls against each other (see below), unrelated to
// any other lock in the app.
const SETUP_ADVISORY_LOCK_KEY = 4_827_193n;

const OIDC_ERROR_KEY: Record<OidcError['code'], string> = {
  not_configured: 'errors.oidcNotConfigured',
  no_email: 'errors.oidcAccountNoEmail',
  not_allowed: 'errors.emailNotAllowed',
  exchange_failed: 'errors.oidcExchangeFailed',
};

function oidcErrorStatus(code: OidcError['code']): number {
  if (code === 'not_configured') return 503;
  if (code === 'exchange_failed') return 400;
  return 403;
}

// Maps internal OIDC error codes to the stable codes the mobile app uses in
// the famlin://oidc-callback redirect, so the app can show a specific message.
function oidcErrorToMobileCode(code: OidcError['code']): string {
  switch (code) {
    case 'not_configured':
      return 'oidc_not_configured';
    case 'no_email':
      return 'oidc_no_email';
    case 'not_allowed':
      return 'email_not_allowed';
    case 'exchange_failed':
      return 'oidc_exchange_failed';
  }
}

export default async function authRoutes(fastify: FastifyInstance) {
  // Public: lets clients discover whether OIDC login is enabled and, if so,
  // which endpoints/client/scopes to use to build their own auth request.
  // Resolving discovery server-side avoids relying on the provider allowing
  // CORS for browser-based clients to fetch it directly.
  fastify.get('/oidc-config', async (request) => {
    const { name, issuer, clientId, clientSecret, scopes } = await getOidcSettings();
    // Some providers (Google) reject a secretless PKCE exchange from a
    // public client — when a secret is configured, clients must hand the
    // authorization code to the backend instead (POST /oidc/exchange for the
    // admin UI, GET /oidc/mobile-callback for the mobile app) rather than
    // exchanging it themselves. The secret itself never leaves the backend.
    const usesClientSecret = !!clientSecret;
    const disabled = {
      enabled: false,
      name,
      authorizationEndpoint: '',
      tokenEndpoint: '',
      clientId: '',
      scopes,
      usesClientSecret,
    };

    if (!issuer || !clientId) {
      return disabled;
    }

    try {
      const { doc } = await getDiscovery(issuer);
      const origin = `${request.protocol}://${request.hostname}`;
      return {
        enabled: true,
        name,
        authorizationEndpoint: doc.authorization_endpoint,
        tokenEndpoint: doc.token_endpoint,
        clientId,
        scopes,
        usesClientSecret,
        ...(usesClientSecret ? { mobileCallbackUrl: `${origin}/api/auth/oidc/mobile-callback` } : {}),
      };
    } catch {
      return disabled;
    }
  });

  // Public: lets the admin UI know whether this is a fresh install with no
  // users yet, so it can show the first-run admin setup screen instead of
  // the login form.
  fastify.get('/setup-status', async () => {
    const userCount = await prisma.user.count();
    return { needsSetup: userCount === 0 };
  });

  // Public, but only succeeds once: provisions the very first admin account
  // on a fresh install. Guarded by a Postgres advisory lock so two concurrent
  // requests can't both pass the "no users yet" check and create two admins
  // — the lock is held for the transaction, so the second caller's count()
  // only runs after the first caller has committed its new user.
  fastify.post(
    '/setup',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const t = getT(request);
      const { email, name, password } = setupBodySchema.parse(request.body);
      const normalizedEmail = email.toLowerCase().trim();
      const passwordHash = await bcrypt.hash(password, 12);

      const user = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_KEY})`;

        const userCount = await tx.user.count();
        if (userCount > 0) {
          return null;
        }

        return tx.user.create({
          data: {
            email: normalizedEmail,
            name,
            passwordHash,
            isAdmin: true,
          },
        });
      });

      if (!user) {
        return reply.status(409).send({ error: t('errors.setupAlreadyComplete') });
      }

      const token = createUserToken({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        tokenVersion: user.tokenVersion,
      });

      return {
        token,
        user: sanitizeUser(user),
      };
    }
  );

  // Generic OIDC login — works with any OpenID Connect provider (Google,
  // Microsoft, Authentik, Keycloak, Auth0, ...) configured via /admin. Used
  // when the client did its own PKCE exchange directly against the provider
  // (the default — see POST /oidc/exchange for providers that need a secret).
  fastify.post(
    '/oidc',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { idToken, inviteToken } = loginBodySchema.parse(request.body);
      const t = getT(request);

      try {
        const outcome = await completeOidcLogin(idToken, inviteToken, t);
        if ('error' in outcome) return reply.status(outcome.error.status).send({ error: outcome.error.error });
        return outcome.result;
      } catch (err) {
        if (err instanceof OidcError) {
          return reply.status(oidcErrorStatus(err.code)).send({ error: t(OIDC_ERROR_KEY[err.code]) });
        }
        fastify.log.error(err);
        return reply.status(401).send({ error: t('errors.authFailed') });
      }
    }
  );

  // Server-mediated OIDC login for the admin UI, used instead of POST /oidc
  // when the provider requires a client secret (e.g. Google) — the browser
  // can't hold the secret, so it hands the authorization code here and the
  // backend does the exchange.
  fastify.post(
    '/oidc/exchange',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { code, redirectUri, codeVerifier, inviteToken } = oidcExchangeBodySchema.parse(request.body);
      const t = getT(request);

      try {
        const idToken = await exchangeOidcCode({ code, redirectUri, codeVerifier });
        const outcome = await completeOidcLogin(idToken, inviteToken, t);
        if ('error' in outcome) return reply.status(outcome.error.status).send({ error: outcome.error.error });
        return outcome.result;
      } catch (err) {
        if (err instanceof OidcError) {
          return reply.status(oidcErrorStatus(err.code)).send({ error: t(OIDC_ERROR_KEY[err.code]) });
        }
        fastify.log.error(err);
        return reply.status(401).send({ error: t('errors.authFailed') });
      }
    }
  );

  // The redirect_uri Google (or another secret-requiring provider) sends the
  // user's browser back to for the mobile app's login. A plain custom-scheme
  // redirect (famlin://) isn't accepted by providers that mandate their own
  // fixed native-app redirect scheme, so this HTTPS URL — under the
  // self-hoster's own domain — is what gets registered with the provider
  // instead; it completes the login server-side, then hands off to the app's
  // famlin:// scheme, which the OS *does* already know how to route back to
  // Famlin. See mobileCallbackUrl in GET /oidc-config and createOidcHandoff.
  fastify.get(
    '/oidc/mobile-callback',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const t = getT(request);
      const { code, state, error } = request.query as { code?: string; state?: string; error?: string };

      // The app validates that the state it sent survives the whole round
      // trip (CSRF binding — see performServerMediatedLogin in the mobile
      // app's utils/oidcLogin.ts) and rejects any callback without it, so
      // every redirect below must echo it, error paths included.
      const stateParam = typeof state === 'string' ? `&state=${encodeURIComponent(state)}` : '';

      if (error || !code) {
        return reply.redirect(`famlin://oidc-callback?error=${encodeURIComponent(error || 'missing_code')}${stateParam}`);
      }

      // The mobile app is a stateless HTTP client with no session on this
      // request, so an in-progress invite claim can only travel through the
      // `state` param Google echoes back unchanged — same trust level as the
      // client-supplied inviteToken already accepted by POST /oidc, since the
      // invite's own validity is what's actually authoritative server-side.
      let inviteToken: string | undefined;
      if (state) {
        try {
          const parsed = JSON.parse(state);
          if (typeof parsed?.inviteToken === 'string') inviteToken = parsed.inviteToken;
        } catch {
          // Malformed state — proceed without an invite token.
        }
      }

      const redirectUri = `${request.protocol}://${request.hostname}/api/auth/oidc/mobile-callback`;
      try {
        const idToken = await exchangeOidcCode({ code, redirectUri });
        const outcome = await completeOidcLogin(idToken, inviteToken, t);
        if ('error' in outcome) {
          fastify.log.warn(
            {
              loginError: outcome.error.error,
              code: outcome.error.code,
              status: outcome.error.status,
              hasInviteToken: !!inviteToken,
              redirectUri,
            },
            'OIDC mobile callback login outcome failed'
          );
          return reply.redirect(`famlin://oidc-callback?error=${outcome.error.code}${stateParam}`);
        }
        const handoff = createOidcHandoff(outcome.result);
        return reply.redirect(`famlin://oidc-callback?handoff=${handoff}${stateParam}`);
      } catch (err) {
        const errorCode = err instanceof OidcError ? oidcErrorToMobileCode(err.code) : 'unknown';
        if (err instanceof OidcError) {
          fastify.log.warn({ oidcError: err.code, errorCode, redirectUri }, 'OIDC mobile callback failed');
        } else {
          fastify.log.error(err);
        }
        return reply.redirect(`famlin://oidc-callback?error=${errorCode}${stateParam}`);
      }
    }
  );

  // Redeems the one-time code from the famlin://oidc-callback deep link for
  // the actual Famlin session token — see createOidcHandoff for why the
  // token itself isn't passed directly in that redirect's query string.
  fastify.post(
    '/oidc/mobile-handoff',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { code } = oidcMobileHandoffBodySchema.parse(request.body);
      const t = getT(request);

      const result = consumeOidcHandoff(code);
      if (!result) {
        return reply.status(400).send({ error: t('errors.oidcHandoffExpired') });
      }
      return result;
    }
  );

  // Local email/password login
  fastify.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { email, password, inviteToken } = passwordLoginBodySchema.parse(request.body);
      const normalizedEmail = email.toLowerCase().trim();
      const t = getT(request);

      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (!user || !user.passwordHash) {
        // Still pay the bcrypt cost so response timing doesn't reveal
        // whether this email has an account.
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        return reply.status(401).send({ error: t('errors.invalidEmailOrPassword') });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: t('errors.invalidEmailOrPassword') });
      }

      if (inviteToken) {
        const { invite, reason } = await getValidInvite(inviteToken);
        if (invite && !reason && (!invite.email || invite.email === user.email)) {
          await consumeInvite(inviteToken, user.id);
        }
      }

      const token = createUserToken({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        tokenVersion: user.tokenVersion,
      });

      return {
        token,
        user: sanitizeUser(user),
      };
    }
  );

  // Register new user (admin only)
  fastify.post('/register', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);

    if (!request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.adminRequired') });
    }

    const { email, name, password, isAdmin } = registerBodySchema.parse(request.body);
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return reply.status(409).send({ error: t('errors.userAlreadyExists') });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        passwordHash,
        isAdmin: isAdmin || false,
      },
    });

    return {
      user: sanitizeUser(user),
    };
  });

  // Change own password
  fastify.post('/change-password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { currentPassword, newPassword } = changePasswordBodySchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
    });

    if (!user || !user.passwordHash) {
      return reply.status(400).send({ error: t('errors.noLocalPasswordSet') });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: t('errors.currentPasswordIncorrect') });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // Bumping tokenVersion invalidates every token issued before this
    // change, including on any other device the account is signed into.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    invalidateSessionCache(user.id);

    return { success: true };
  });

  // Admin reset/set user password
  fastify.post('/reset-password/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);

    if (!request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.adminRequired') });
    }

    const { id } = request.params as { id: string };
    const { newPassword } = resetPasswordBodySchema.parse(request.body);

    const passwordHash = await bcrypt.hash(newPassword, 12);

    try {
      const user = await prisma.user.update({
        where: { id },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      invalidateSessionCache(id);

      return { success: true, user: sanitizeUser(user) };
    } catch (err: any) {
      // Prisma "record not found" on update.
      if (err?.code === 'P2025') {
        return reply.status(404).send({ error: t('errors.userNotFound') });
      }
      throw err;
    }
  });

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      include: {
        groupMemberships: {
          include: { group: true },
        },
      },
    });

    if (!user) {
      return reply.status(404).send({ error: t('errors.userNotFound') });
    }

    return {
      ...sanitizeUser(user),
      groups: user.groupMemberships.map((m) => m.group),
    };
  });

  fastify.patch('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    const body = updateUserBodySchema.parse(request.body);

    const user = await prisma.user.update({
      where: { id: request.user!.id },
      data: body,
    });

    return sanitizeUser(user);
  });

  // Public: lets clients know whether the server has push/email
  // notifications enabled at all, so they can skip requesting permission /
  // registering an Expo push token, and hide the corresponding preference
  // toggles, when the admin has turned a channel off.
  fastify.get('/notification-config', async () => {
    const settings = await getAllSettings();
    return {
      pushEnabled: settings.pushNotificationsEnabled,
      emailEnabled: settings.emailNotificationsEnabled,
    };
  });

  // Public: lets clients (e.g. the mobile app's profile screen) display
  // which server version they're connected to.
  fastify.get('/server-info', async () => {
    return { version: pkg.version };
  });
}
