import { prisma } from '../db.js';
import { verifyOidcToken, createUserToken } from '../plugins/auth.js';
import { isEmailAllowed } from './settings.js';
import { getValidInvite, consumeInvite, inviteFailureResponse } from './invites.js';
import { sanitizeUser } from './users.js';

interface FailureResponse {
  status: number;
  error: string;
  code: string;
}

// What every federated identity provider has to reduce to before Famlin will
// provision an account for it. `name` is optional because Sign in with Apple
// only ever discloses it on the very first authorization — an omitted name
// means "keep whatever the account already has".
export interface FederatedIdentity {
  email: string;
  name?: string;
  picture?: string;
}

type LoginOutcome =
  | { error: FailureResponse }
  | { result: { token: string; user: ReturnType<typeof sanitizeUser> } };

// The shared tail of every federated login — OIDC (POST /oidc, POST
// /oidc/exchange, GET /oidc/mobile-callback) and Sign in with Apple (POST
// /apple). Validates the invite first, because whether one is in play decides
// if the provider's email has to be on the allowedEmails whitelist, then
// provisions/updates the local user and issues a Famlin session token.
// `verifyIdentity` is the provider-specific step and is the only thing that
// talks to the provider.
export async function completeFederatedLogin(
  verifyIdentity: (options: { allowUnlisted: boolean }) => Promise<FederatedIdentity>,
  inviteToken: string | undefined,
  t: (key: string) => string
): Promise<LoginOutcome> {
  let invite: Awaited<ReturnType<typeof getValidInvite>>['invite'] = null;
  if (inviteToken) {
    const { invite: found, reason } = await getValidInvite(inviteToken);
    const failure = inviteFailureResponse(reason, t);
    if (failure) return { error: failure };
    invite = found;
  }

  const identity = await verifyIdentity({ allowUnlisted: !!invite });

  if (invite?.email && invite.email !== identity.email) {
    return { error: { status: 403, error: t('errors.inviteEmailMismatch'), code: 'invite_email_mismatch' } };
  }

  let user = await prisma.user.findUnique({ where: { email: identity.email } });

  if (!user) {
    // Only provision a new account when the email is whitelisted for federated
    // login (an empty allowedEmails list means "allow everyone"), unless a
    // valid invite is covering this signup.
    if (!invite && !(await isEmailAllowed(identity.email))) {
      return { error: { status: 403, error: t('errors.emailNotAllowed'), code: 'email_not_allowed' } };
    }

    user = await prisma.user.create({
      data: {
        email: identity.email,
        name: identity.name || identity.email.split('@')[0],
        avatarUrl: identity.picture,
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: identity.name || user.name,
        avatarUrl: identity.picture || user.avatarUrl,
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

  return { result: { token, user: sanitizeUser(user) } };
}

// Shared by every OIDC entry point (direct client-side PKCE at POST /oidc,
// the server-mediated code exchange at POST /oidc/exchange, and the mobile
// callback redirect at GET /oidc/mobile-callback) — provisions/updates the
// local user for a verified OIDC identity and issues a Famlin session token.
// Callers pass an already-obtained idToken; verification against the
// configured provider happens here.
export async function completeOidcLogin(
  idToken: string,
  inviteToken: string | undefined,
  t: (key: string) => string
): Promise<LoginOutcome> {
  return completeFederatedLogin((options) => verifyOidcToken(idToken, options), inviteToken, t);
}
