import {
  fetchServerInfo,
  getCurrentServerUrl,
  isNotFoundError,
  serverFeatureSupport,
  type FeatureSupport,
  type ServerFeature,
  type ServerInfo,
} from '@famlin/api-client'

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
    return serverFeatureSupport(await entry.info, feature)
  } catch {
    return 'unknown'
  }
}

// react-query `retry` for a feature-gated query: a 404 means an older server
// without the endpoint, so it's final — anything else retries as usual.
export function retryUnlessNotFound(failureCount: number, error: unknown): boolean {
  return !isNotFoundError(error) && failureCount < 3
}

// Tests only: forget the memoized server-info.
export function resetServerFeatureCache() {
  cached = null
}
