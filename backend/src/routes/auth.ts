import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { verifyOidcToken, createUserToken, getDiscovery, OidcError, invalidateSessionCache } from '../plugins/auth.js';
import { isEmailAllowed, getOidcSettings, getAllSettings } from '../services/settings.js';
import { getValidInvite, consumeInvite, inviteFailureResponse } from '../services/invites.js';
import { getT } from '../i18n/index.js';
import { sanitizeUser } from '../services/users.js';
import {
  loginBodySchema,
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
};

export default async function authRoutes(fastify: FastifyInstance) {
  // Public: lets clients discover whether OIDC login is enabled and, if so,
  // which endpoints/client/scopes to use to build their own auth request.
  // Resolving discovery server-side avoids relying on the provider allowing
  // CORS for browser-based clients to fetch it directly.
  fastify.get('/oidc-config', async () => {
    const { name, issuer, clientId, scopes } = await getOidcSettings();
    const disabled = { enabled: false, name, authorizationEndpoint: '', tokenEndpoint: '', clientId: '', scopes };

    if (!issuer || !clientId) {
      return disabled;
    }

    try {
      const { doc } = await getDiscovery(issuer);
      return {
        enabled: true,
        name,
        authorizationEndpoint: doc.authorization_endpoint,
        tokenEndpoint: doc.token_endpoint,
        clientId,
        scopes,
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
  // Microsoft, Authentik, Keycloak, Auth0, ...) configured via /admin.
  fastify.post(
    '/oidc',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const { idToken, inviteToken } = loginBodySchema.parse(request.body);
      const t = getT(request);

      try {
        // A valid invite is its own authorization: it can let an OIDC login
        // provision an account even for an email that isn't on the
        // allowedEmails whitelist. Resolve it up front so we know whether to
        // relax that check before verifying the token.
        let invite: Awaited<ReturnType<typeof getValidInvite>>['invite'] = null;
        if (inviteToken) {
          const result = await getValidInvite(inviteToken);
          const failure = inviteFailureResponse(result.reason, t);
          if (failure) return reply.status(failure.status).send({ error: failure.error });
          invite = result.invite;
        }

        const oidcUser = await verifyOidcToken(idToken, { allowUnlisted: !!invite });

        if (invite?.email && invite.email !== oidcUser.email) {
          return reply.status(403).send({ error: t('errors.inviteEmailMismatch') });
        }

        let user = await prisma.user.findUnique({
          where: { email: oidcUser.email },
        });

        if (!user) {
          // Only provision a new account when the email is whitelisted for
          // OIDC login (an empty allowedEmails list means "allow everyone"),
          // unless a valid invite is covering this signup.
          if (!invite && !(await isEmailAllowed(oidcUser.email))) {
            return reply.status(403).send({ error: t('errors.emailNotAllowed') });
          }

          user = await prisma.user.create({
            data: {
              email: oidcUser.email,
              name: oidcUser.name,
              avatarUrl: oidcUser.picture,
            },
          });
        } else {
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              name: oidcUser.name,
              avatarUrl: oidcUser.picture || user.avatarUrl,
            },
          });
        }

        if (inviteToken) {
          await consumeInvite(inviteToken, user.id);
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
      } catch (err) {
        if (err instanceof OidcError) {
          const status = err.code === 'not_configured' ? 503 : 403;
          return reply.status(status).send({ error: t(OIDC_ERROR_KEY[err.code]) });
        }
        fastify.log.error(err);
        return reply.status(401).send({ error: t('errors.authFailed') });
      }
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
}
