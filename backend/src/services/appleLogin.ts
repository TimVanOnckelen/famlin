import { createHash } from 'crypto'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { getAppleSettings, isEmailAllowed } from './settings.js'
import { completeFederatedLogin, FederatedIdentity } from './oidcLogin.js'
import { sanitizeUser } from './users.js'

// Apple's identity tokens are ordinary OIDC ID tokens, so verification needs
// nothing configured per deployment: the issuer is fixed and the audience is
// the app's own bundle identifier, which is baked into the client build
// rather than into the server. That's what makes Sign in with Apple work on
// every self-hosted Famlin without the admin registering anything — see
// appleBundleIds in services/settings.ts for the self-builder escape hatch.
const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys')

// createRemoteJWKSet caches and rotates the keyset itself, so this is created
// once for the process rather than per login. Held in an object so tests can
// swap in a local keyset (the backupDeps pattern).
export const appleDeps: { jwks: JWTVerifyGetKey } = { jwks: createRemoteJWKSet(APPLE_JWKS_URL) }

// Server binding for the token's `nonce` claim. Every Famlin server accepts
// tokens minted for the same shared app (be.xeweb.famlin), so without it a
// token the app sent to one server — a malicious one, or one an invite link
// pointed it at — could be replayed to another within its ~10 minute
// lifetime, logging in as that user there. The app (mobile
// utils/appleLogin.ts) asks Apple for
//   nonce = sha256hex("famlin-apple-signin|<nonceHost>|<rawNonce>")
// where nonceHost is the server host it is talking to, and sends nonceHost
// and rawNonce with the token. Keep the format in lockstep with the app.
export function appleNonceFor(host: string, rawNonce: string): string {
  return createHash('sha256').update(`famlin-apple-signin|${host}|${rawNonce}`).digest('hex')
}

// Hostname only (lowercase, no port, no trailing dot): a proxy forwarding
// `Host $host` drops a non-default port, and a port on the same hostname
// doesn't separate one server operator from another.
function hostnameOf(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

interface AppleNonceBinding {
  rawNonce?: string
  nonceHost?: string
  // The host this server knows itself by: the publicUrl setting's, else the
  // request's own Host header — never X-Forwarded-Host, which a client can
  // set and a proxy may pass through.
  serverHost: string
}

// Thrown for expected, user-facing Sign in with Apple failures so the route
// can map them to a translated message instead of leaking jose internals.
export class AppleAuthError extends Error {
  constructor(
    public code: 'invalid_token' | 'host_mismatch' | 'no_email' | 'not_allowed',
    // host_mismatch only: both hosts, for the server log.
    public hosts?: { app: string; server: string }
  ) {
    super(code)
    this.name = 'AppleAuthError'
  }
}

interface AppleIdentityTokenPayload {
  nonce?: string
  email?: string
  email_verified?: boolean | string
  is_private_email?: boolean | string
}

// Verifies an Apple identity token and reduces it to the identity shape the
// shared federated-login path works with. `fullName` is passed in by the
// client rather than read from the token: Apple discloses the user's name
// exactly once, in the authorization response of the very first sign-in, and
// never in the token itself.
export async function verifyAppleIdentityToken(
  identityToken: string,
  fullName: string | undefined,
  binding: AppleNonceBinding,
  options?: { allowUnlisted?: boolean }
): Promise<FederatedIdentity> {
  const { bundleIds } = await getAppleSettings()

  let payload: AppleIdentityTokenPayload
  try {
    ;({ payload } = await jwtVerify(identityToken, appleDeps.jwks, {
      issuer: APPLE_ISSUER,
      audience: bundleIds,
    }))
  } catch {
    throw new AppleAuthError('invalid_token')
  }

  // A token carrying a nonce must have been requested for this server. One
  // without is from an app build predating the binding and is still accepted
  // for now; drop that once MIN_APP_VERSION excludes those builds.
  if (payload.nonce !== undefined) {
    const { rawNonce, nonceHost, serverHost } = binding
    if (!rawNonce || !nonceHost || appleNonceFor(nonceHost, rawNonce) !== payload.nonce) {
      throw new AppleAuthError('invalid_token')
    }
    if (hostnameOf(nonceHost) !== hostnameOf(serverHost)) {
      throw new AppleAuthError('host_mismatch', { app: nonceHost, server: serverHost })
    }
  }

  const email = payload.email?.toLowerCase()
  if (!email) {
    // Only happens when the user signed in without sharing an email at all;
    // Famlin keys accounts on email, so there's nothing to provision.
    throw new AppleAuthError('no_email')
  }

  // A valid invite is its own authorization, so it can provision an account
  // for an email that isn't on the allowedEmails whitelist — including Apple's
  // private-relay addresses, which by design won't be on anyone's whitelist.
  if (!options?.allowUnlisted && !(await isEmailAllowed(email))) {
    throw new AppleAuthError('not_allowed')
  }

  return { email, name: fullName?.trim() || undefined }
}

export async function completeAppleLogin(
  identityToken: string,
  fullName: string | undefined,
  inviteToken: string | undefined,
  t: (key: string) => string,
  binding: AppleNonceBinding
): Promise<
  | { error: { status: number; error: string; code: string } }
  | { result: { token: string; user: ReturnType<typeof sanitizeUser> } }
> {
  return completeFederatedLogin(
    (options) => verifyAppleIdentityToken(identityToken, fullName, binding, options),
    inviteToken,
    t
  )
}
