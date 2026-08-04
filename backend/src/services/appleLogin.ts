import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getAppleSettings, isEmailAllowed } from './settings.js';
import { completeFederatedLogin, FederatedIdentity } from './oidcLogin.js';
import { sanitizeUser } from './users.js';

// Apple's identity tokens are ordinary OIDC ID tokens, so verification needs
// nothing configured per deployment: the issuer is fixed and the audience is
// the app's own bundle identifier, which is baked into the client build
// rather than into the server. That's what makes Sign in with Apple work on
// every self-hosted Famlin without the admin registering anything — see
// appleBundleIds in services/settings.ts for the self-builder escape hatch.
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

// createRemoteJWKSet caches and rotates the keyset itself, so this is created
// once for the process rather than per login.
const appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);

// Thrown for expected, user-facing Sign in with Apple failures so the route
// can map them to a translated message instead of leaking jose internals.
export class AppleAuthError extends Error {
  constructor(public code: 'invalid_token' | 'no_email' | 'not_allowed') {
    super(code);
    this.name = 'AppleAuthError';
  }
}

interface AppleIdentityTokenPayload {
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

// Verifies an Apple identity token and reduces it to the identity shape the
// shared federated-login path works with. `fullName` is passed in by the
// client rather than read from the token: Apple discloses the user's name
// exactly once, in the authorization response of the very first sign-in, and
// never in the token itself.
export async function verifyAppleIdentityToken(
  identityToken: string,
  fullName: string | undefined,
  options?: { allowUnlisted?: boolean }
): Promise<FederatedIdentity> {
  const { bundleIds } = await getAppleSettings();

  let payload: AppleIdentityTokenPayload;
  try {
    ({ payload } = await jwtVerify(identityToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience: bundleIds,
    }));
  } catch {
    throw new AppleAuthError('invalid_token');
  }

  const email = payload.email?.toLowerCase();
  if (!email) {
    // Only happens when the user signed in without sharing an email at all;
    // Famlin keys accounts on email, so there's nothing to provision.
    throw new AppleAuthError('no_email');
  }

  // A valid invite is its own authorization, so it can provision an account
  // for an email that isn't on the allowedEmails whitelist — including Apple's
  // private-relay addresses, which by design won't be on anyone's whitelist.
  if (!options?.allowUnlisted && !(await isEmailAllowed(email))) {
    throw new AppleAuthError('not_allowed');
  }

  return { email, name: fullName?.trim() || undefined };
}

export async function completeAppleLogin(
  identityToken: string,
  fullName: string | undefined,
  inviteToken: string | undefined,
  t: (key: string) => string
): Promise<
  | { error: { status: number; error: string; code: string } }
  | { result: { token: string; user: ReturnType<typeof sanitizeUser> } }
> {
  return completeFederatedLogin(
    (options) => verifyAppleIdentityToken(identityToken, fullName, options),
    inviteToken,
    t
  );
}
