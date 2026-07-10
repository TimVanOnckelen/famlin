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

// Shared by every OIDC entry point (direct client-side PKCE at POST /oidc,
// the server-mediated code exchange at POST /oidc/exchange, and the mobile
// callback redirect at GET /oidc/mobile-callback) — provisions/updates the
// local user for a verified OIDC identity and issues a Famlin session token.
// Callers pass an already-verified idToken; this doesn't touch the provider.
export async function completeOidcLogin(
  idToken: string,
  inviteToken: string | undefined,
  t: (key: string) => string
): Promise<{ error: FailureResponse } | { result: { token: string; user: ReturnType<typeof sanitizeUser> } }> {
  let invite: Awaited<ReturnType<typeof getValidInvite>>['invite'] = null;
  if (inviteToken) {
    const { invite: found, reason } = await getValidInvite(inviteToken);
    const failure = inviteFailureResponse(reason, t);
    if (failure) return { error: failure };
    invite = found;
  }

  const oidcUser = await verifyOidcToken(idToken, { allowUnlisted: !!invite });

  if (invite?.email && invite.email !== oidcUser.email) {
    return { error: { status: 403, error: t('errors.inviteEmailMismatch'), code: 'invite_email_mismatch' } };
  }

  let user = await prisma.user.findUnique({ where: { email: oidcUser.email } });

  if (!user) {
    // Only provision a new account when the email is whitelisted for OIDC
    // login (an empty allowedEmails list means "allow everyone"), unless a
    // valid invite is covering this signup.
    if (!invite && !(await isEmailAllowed(oidcUser.email))) {
      return { error: { status: 403, error: t('errors.emailNotAllowed'), code: 'email_not_allowed' } };
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

  return { result: { token, user: sanitizeUser(user) } };
}
