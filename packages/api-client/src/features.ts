import type { ServerInfo } from './auth'

// Named server capabilities, mirroring SERVER_FEATURES in
// backend/src/serverFeatures.ts (issue #380). Clients detect what an older
// self-hosted server can do by these names, never by comparing versions.
// Ids are stable — never renamed or removed — and a new client-visible
// capability adds its id on both sides. The comment is the first release.
export type ServerFeature =
  | 'accountDeletion' // 0.6.3
  | 'circles' // 0.7.0
  | 'stories' // 0.8.0
  | 'memberExport' // 0.8.0
  | 'giftLists' // 0.8.5
  | 'uploadProcessing' // 0.8.7
  | 'livePhotos' // 0.8.7
  | 'deviceDiagnostics' // after 0.8.7

// What a server that sends no `features` array is known to support.
// Servers started advertising features after 0.8.7, so one without the
// field could be anything from the support-window floor (0.5.0) up to
// 0.8.7 — the baseline may therefore only hold features every server since
// 0.5.0 has. Every id above is newer than that, so the baseline is empty;
// it only grows if an id is added for a capability 0.5.0 already had.
// Anything newer is "unknown" on such a server, not "unsupported": a 0.8.7
// server has stories, circles, gift lists and upload processing without
// saying so, so clients detect those by trying the endpoint and treating a
// 404 as unsupported (see serverFeatureSupport() below).
export const IMPLICIT_BASELINE_FEATURES: readonly ServerFeature[] = []

// Strict check against a server-info response: true only when the server
// advertises the feature (or it's in the implicit baseline). `null`/
// `undefined` (not loaded yet, or the request failed) and a response
// without `features` (an older server) both count as not advertised. Use
// serverFeatureSupport() to decide whether to *offer* a feature — this is
// false on servers that may well have it.
export function serverSupports(serverInfo: ServerInfo | null | undefined, feature: ServerFeature): boolean {
  return serverFeatureSupport(serverInfo, feature) === 'supported'
}

export type FeatureSupport = 'supported' | 'unsupported' | 'unknown'

// Three-state check, the one clients gate UI on:
// - 'supported': the server lists the feature (or it's in the baseline).
// - 'unsupported': the server sends a `features` list without it — hide
//   the feature and never call its endpoints.
// - 'unknown': server-info hasn't loaded/failed, or the server predates the
//   `features` field (0.8.7 and older). Try the feature anyway, and treat a
//   404 from its endpoint (isNotFoundError) as unsupported: hide it
//   silently, no error UI, no retry.
export function serverFeatureSupport(
  serverInfo: ServerInfo | null | undefined,
  feature: ServerFeature
): FeatureSupport {
  if (IMPLICIT_BASELINE_FEATURES.includes(feature)) return 'supported'
  if (!serverInfo || !Array.isArray(serverInfo.features)) return 'unknown'
  return serverInfo.features.includes(feature) ? 'supported' : 'unsupported'
}

// Whether a request failed with a 404 — the "unknown" fallback's signal
// that an older server doesn't have the endpoint at all.
export function isNotFoundError(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null | undefined)?.response?.status === 404
}
