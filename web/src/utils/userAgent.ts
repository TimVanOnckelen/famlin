// Turns the User-Agent a session was created with into something a person
// recognises in their device list ("Firefox", "macOS"). Heuristic on purpose:
// it only labels rows, nothing depends on it. Browser and OS names are proper
// nouns, so they aren't translated; the sentence around them is.
export interface DescribedAgent {
  // The browser, or null for the mobile app / an unrecognised client.
  browser: string | null
  os: string | null
  // The Famlin mobile app (its HTTP stack's User-Agent, not a browser's).
  app: boolean
}

export function describeUserAgent(userAgent: string | null | undefined): DescribedAgent {
  const ua = userAgent ?? ''

  // React Native's networking: CFNetwork/Darwin on iOS, okhttp on Android.
  if (/CFNetwork\/.*Darwin\//.test(ua)) return { browser: null, os: 'iOS', app: true }
  if (/^okhttp\//i.test(ua)) return { browser: null, os: 'Android', app: true }

  let os: string | null = null
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Linux/.test(ua)) os = 'Linux'

  let browser: string | null = null
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox'
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua)) browser = 'Safari'

  return { browser, os, app: false }
}
