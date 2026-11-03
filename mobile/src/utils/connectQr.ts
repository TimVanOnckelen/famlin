// "Connect the mobile app" QR codes and deep links (issue #345).
//
// The server shows a QR code encoding `<origin>/connect` (admin dashboard,
// web profile). It is scanned either with the phone's own camera, which opens
// the server's /connect landing page and from there `famlin://connect?server=`,
// or with the in-app scanner on the login screen, which reads the QR directly.
// Both end up as a server origin.

// scheme://host[:port], no credentials. RN's URL polyfill doesn't implement
// `host`, so this is parsed by hand.
const HTTP_ORIGIN = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?$/i

function toOrigin(raw: string): string | null {
  const match = HTTP_ORIGIN.exec(raw.trim())
  if (!match) return null
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3] ?? ''}`
}

/**
 * Extracts a server origin from scanned QR data or a `famlin://connect` link.
 * Accepts `https?://host[:port]/connect` (query/hash allowed) and
 * `famlin://connect?server=<url>`; returns null for anything else.
 */
export function parseConnectQr(data: string): string | null {
  if (typeof data !== 'string') return null
  const text = data.trim()
  if (!text || text.length > 2048) return null

  const deepLink = /^famlin:\/\/connect\/?\?(.*)$/i.exec(text)
  if (deepLink) {
    const query = deepLink[1].split('#')[0]
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=')
      if (eq === -1 || pair.slice(0, eq) !== 'server') continue
      try {
        return toOrigin(decodeURIComponent(pair.slice(eq + 1)))
      } catch {
        return null
      }
    }
    return null
  }

  const web = /^(https?:\/\/[^/?#]+)\/connect\/?(?:[?#].*)?$/i.exec(text)
  return web ? toOrigin(web[1]) : null
}

/** True when two server addresses name the same origin. */
export function isSameServer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const left = toOrigin(a.trim().replace(/\/+$/, '')) ?? a.trim().replace(/\/+$/, '').toLowerCase()
  const right = toOrigin(b.trim().replace(/\/+$/, '')) ?? b.trim().replace(/\/+$/, '').toLowerCase()
  return left === right
}
