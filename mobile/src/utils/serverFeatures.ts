import {
  fetchServerInfo,
  getCurrentServerUrl,
  serverSupports,
  type ServerFeature,
  type ServerInfo,
} from '@famlin/api-client'

// Non-hook counterpart of useServerSupports() (hooks/useServerInfo.ts) for
// code outside React — device diagnostics, logout — that must skip an
// endpoint the connected server doesn't have (issue #380). Server-info is
// memoized per server for a while, like the hook's query; a failed request
// isn't cached and reads as the implicit baseline (unsupported), so the
// caller silently skips rather than erroring. Never throws.
const TTL_MS = 10 * 60 * 1000
let cached: { serverUrl: string; at: number; info: Promise<ServerInfo> } | null = null

export async function checkServerSupports(feature: ServerFeature): Promise<boolean> {
  try {
    const serverUrl = getCurrentServerUrl()
    if (!serverUrl) return false
    let entry = cached
    if (!entry || entry.serverUrl !== serverUrl || Date.now() - entry.at > TTL_MS) {
      const info = fetchServerInfo()
      entry = { serverUrl, at: Date.now(), info }
      cached = entry
      info.catch(() => {
        if (cached?.info === info) cached = null
      })
    }
    return serverSupports(await entry.info, feature)
  } catch {
    return false
  }
}

// Tests only: forget the memoized server-info.
export function resetServerFeatureCache() {
  cached = null
}
