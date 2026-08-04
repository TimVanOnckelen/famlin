import path from 'path';

/**
 * The canonical pathname a request will actually be *routed* to, derived from
 * its raw URL.
 *
 * Every guard that decides "does this request touch protected path X?" must
 * compare against this, never against `request.raw.url` directly. The raw URL
 * is whatever the client typed on the request line; the router and
 * `@fastify/static` resolve a normalized, percent-decoded form of it. When a
 * guard tests one string and the server serves another, a non-canonical URL
 * slips past the guard and still reaches the resource — the bypass class
 * behind the `@fastify/static` "Authorization Bypass via Non-Canonical URL
 * Paths" advisory, and equally reachable through a hand-rolled hook.
 *
 * Concretely, all of these have a raw URL that does NOT start with
 * `/uploads/` while still resolving to an uploads path:
 *   //uploads/x.jpg        (duplicate leading slash)
 *   /./uploads/x.jpg       (single-dot segment)
 *   /uploads%2Fx.jpg       (percent-encoded separator)
 *   /anything/../uploads/x.jpg
 * and this one starts with `/uploads/` but escapes the originals check:
 *   /uploads/a/../originals/x.heic
 *
 * Percent-decoding is applied exactly once, matching what the server does, so
 * this neither under- nor over-normalizes relative to the path that is served.
 */
export function requestPathname(rawUrl: string | undefined): string {
  const pathOnly = (rawUrl ?? '').split('?')[0].split('#')[0];
  if (pathOnly === '') return '/';

  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    // Malformed percent-escapes (a lone `%`): keep the undecoded form rather
    // than throwing. A guard comparing the raw-ish string is still safe here —
    // the server can't decode it either, so it won't resolve to a real file.
  }

  // Collapse duplicate slashes BEFORE normalize: path.posix.normalize
  // deliberately preserves a leading `//` (POSIX permits it to be
  // implementation-defined), which would otherwise survive as `//uploads/`.
  const collapsed = decoded.replace(/\/{2,}/g, '/');
  const normalized = path.posix.normalize(collapsed);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}
