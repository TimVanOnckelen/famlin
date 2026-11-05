// Named capabilities this server advertises in GET /api/auth/server-info's
// `features` array (issue #380), so a newer mobile app talking to an older
// self-hosted server can hide what that server can't do — by feature, never
// by comparing version numbers.
//
// Rules:
// - Ids are stable: never rename or remove one once released. A client only
//   ever asks "is X in the list?", so a renamed id reads as "unsupported" on
//   every server and silently hides the feature.
// - Every PR adding a client-visible capability (a new endpoint, response
//   field or behavior an app has to detect before using it) adds its id
//   here, plus the matching `ServerFeature` member in
//   packages/api-client/src/features.ts.
// - Servers that predate this list send no `features` at all; clients then
//   assume only `IMPLICIT_BASELINE_FEATURES` (packages/api-client), so ids
//   for capabilities older than the server that introduced this list must
//   stay here too — they can't be inferred from its absence.
//
// The comment after each id is the release that first shipped it.
export const SERVER_FEATURES = [
  'circles', // 0.7.0 — Family Circles (/api/circles, post/story circleId)
  'stories', // 0.8.0 — /api/stories
  'giftLists', // 0.8.5 — GIFT_LIST posts + /api/gift-lists
  'uploadProcessing', // 0.8.7 — GET /api/uploads/status/:assetKey + post upload metadata
  'livePhotos', // 0.8.7 — Live Photo pairing (`kind: 'livePhoto'`, `videoUrl`)
  'deviceDiagnostics', // unreleased after 0.8.7 — /api/devices
] as const

export type ServerFeature = (typeof SERVER_FEATURES)[number]
