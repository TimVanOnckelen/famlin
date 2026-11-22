import type { FastifyRequest } from 'fastify'

// Builds a public origin from the request that reached us, since this app has
// no dedicated PUBLIC_URL env var — self-hosted deployments vary, but the
// reverse proxy (or the caller's own browser, for a direct connection) tells
// us the address that actually works. request.protocol and request.host
// already resolve X-Forwarded-Proto/Host correctly when TRUST_PROXY is
// enabled (see app.ts), and fall back to the raw connection otherwise — so a
// directly-exposed server can't have its origin spoofed by a client-supplied
// header.
//
// request.host, not request.hostname: Fastify 5 redefined hostname to exclude
// the port (4 included it) and added host as the port-carrying property. An
// origin built from hostname would silently drop the port on any deployment
// not served on 80/443, producing links that don't resolve.
export function getPublicOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`
}
