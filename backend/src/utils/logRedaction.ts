// Path segments that are secrets: the personal calendar feed token
// (/api/calendar/<token>/famlin.ics, issue #499). The URL is the credential
// there, so it must never reach a log line. Matched on the raw URL, and
// loosely (any `calendar/` segment, a percent-encoded slash too) so a
// non-canonical spelling of the path can't slip the secret past it.
const SECRET_PATH_SEGMENTS = /(calendar(?:\/|%2f)+)[^/?#]+/gi

export function redactLoggedUrl(url: string | undefined): string | undefined {
  return url?.replace(SECRET_PATH_SEGMENTS, '$1[redacted]')
}

// Fastify's default `req` log serializer, with the URL redacted. Every
// request log line ("incoming request", "request completed") goes through it.
// Structurally typed, and its return type must fit Fastify's `req`
// serializer signature exactly (`version` a plain string): any mismatch makes
// Fastify() silently resolve to its HTTP/2 overload instead.
interface LoggedRequest {
  method: string
  url: string
  headers?: Record<string, string | string[] | undefined>
  host?: string
  ip?: string
  socket?: { remotePort?: number }
}

export function requestLogSerializer(request: LoggedRequest) {
  const version = request.headers?.['accept-version']
  return {
    method: request.method,
    url: redactLoggedUrl(request.url),
    version: Array.isArray(version) ? version[0] : version,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  }
}
