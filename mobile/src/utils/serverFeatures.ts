import {
  fetchServerInfo,
  getCurrentServerUrl,
  isNotFoundError,
  serverFeatureSupport,
  type FeatureSupport,
  type ServerFeature,
  type ServerInfo,
} from '@famlin/api-client'

// Features a server answered 404 for while it was 'unknown' (it predates the
// `features` field), keyed by server: the 404 proves it lacks them, so
// later checks report 'unsupported' and later mounts of a gated query stay
// disabled instead of asking again. In memory only — an app restart asks
// once more — and it only ever turns 'unknown' into 'unsupported', so a
// server that is upgraded and starts advertising features wins over it.
const missingFeatures = new Set<string>()

function missingKey(feature: ServerFeature): string | null {
  const serverUrl = getCurrentServerUrl()
  return serverUrl ? `${serverUrl}\n${feature}` : null
}

export function markFeatureMissing(feature: ServerFeature) {
  const key = missingKey(feature)
  if (key) missingFeatures.add(key)
}

export function isFeatureMarkedMissing(feature: ServerFeature): boolean {
  const key = missingKey(feature)
  return key !== null && missingFeatures.has(key)
}

// Applies the 404 mark to a server-info based answer.
export function withMissingMark(support: FeatureSupport, feature: ServerFeature): FeatureSupport {
  return support === 'unknown' && isFeatureMarkedMissing(feature) ? 'unsupported' : support
}

// Wraps a feature-gated query's fetcher so a 404 is remembered
// (markFeatureMissing) before the error reaches react-query.
export function rememberNotFound<A extends unknown[], T>(
  feature: ServerFeature,
  fetcher: (...args: A) => Promise<T>
): (...args: A) => Promise<T> {
  return async (...args: A) => {
    try {
      return await fetcher(...args)
    } catch (error) {
      if (isNotFoundError(error)) markFeatureMissing(feature)
      throw error
    }
  }
}

// Non-hook counterpart of useServerFeatureSupport() (hooks/useServerInfo.ts)
// for code outside React — device diagnostics, logout (issue #380).
// Server-info is memoized per server for a while, like the hook's query; a
// failed request isn't cached and reads as 'unknown', so the caller tries
// the endpoint and treats a 404 as unsupported. Never throws.
const TTL_MS = 10 * 60 * 1000
let cached: { serverUrl: string; at: number; info: Promise<ServerInfo> } | null = null

export async function checkServerFeature(feature: ServerFeature): Promise<FeatureSupport> {
  try {
    const serverUrl = getCurrentServerUrl()
    if (!serverUrl) return 'unknown'
    let entry = cached
    if (!entry || entry.serverUrl !== serverUrl || Date.now() - entry.at > TTL_MS) {
      const info = fetchServerInfo()
      entry = { serverUrl, at: Date.now(), info }
      cached = entry
      info.catch(() => {
        if (cached?.info === info) cached = null
      })
    }
    return withMissingMark(serverFeatureSupport(await entry.info, feature), feature)
  } catch {
    return withMissingMark('unknown', feature)
  }
}

// react-query `retry` for a feature-gated query: a 404 means an older server
// without the endpoint, so it's final — anything else retries as usual.
export function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !isNotFoundError(error) && failureCount < 3
}

// Tests only: forget the memoized server-info and every recorded 404.
export function resetServerFeatureCache() {
  cached = null
  missingFeatures.clear()
}
