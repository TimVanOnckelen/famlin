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

// What a server that sends no `features` array is assumed to support.
// Servers started advertising features after 0.8.7, so one without the
// field could be anything from the support-window floor (0.5.0) up to
// 0.8.7 — the baseline may therefore only hold features every server since
// 0.5.0 has. Every id above is newer than that, so the baseline is empty;
// it only grows if an id is added for a capability 0.5.0 already had.
export const IMPLICIT_BASELINE_FEATURES: readonly ServerFeature[] = []

// Pure check against a server-info response. `null`/`undefined` (not loaded
// yet, or the request failed) and a response without `features` (an older
// server) both fall back to IMPLICIT_BASELINE_FEATURES — unknown is treated
// as "oldest server in the window", so a feature is never offered to a
// server that might not have it.
export function serverSupports(serverInfo: ServerInfo | null | undefined, feature: ServerFeature): boolean {
  const features: readonly string[] = serverInfo?.features ?? IMPLICIT_BASELINE_FEATURES
  return features.includes(feature)
}
