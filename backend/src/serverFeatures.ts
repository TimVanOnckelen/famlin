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
//   know only `IMPLICIT_BASELINE_FEATURES` (packages/api-client) for sure.
//   Ids for capabilities that shipped before this list
//   (`PRE_FEATURE_LIST_FEATURES` there) are "unknown" on such a server — try
//   it, and a 404 means unsupported — and every other id, i.e. anything
//   shipped with or after this list (deviceDiagnostics onward), is
//   "unsupported", so a new id needs no extra step on the client.
//   Ids for capabilities older than the server that introduced this list
//   must stay here too: a server sending the list without an id is read as
//   definitely lacking it.
//
// The comment after each id is the release that first shipped it.
export const SERVER_FEATURES = [
  'accountDeletion', // 0.6.3 — DELETE /api/auth/me (self-service account deletion)
  'circles', // 0.7.0 — Family Circles (/api/circles, post/story circleId)
  'stories', // 0.8.0 — /api/stories
  'memberExport', // 0.8.0 — GET /api/auth/me/export (member data export)
  'giftLists', // 0.8.5 — GIFT_LIST posts + /api/gift-lists
  'uploadProcessing', // 0.8.7 — GET /api/uploads/status/:assetKey + post upload metadata
  'livePhotos', // 0.8.7 — Live Photo pairing (`kind: 'livePhoto'`, `videoUrl`)
  'deviceDiagnostics', // unreleased after 0.8.7 — /api/devices
] as const

export type ServerFeature = (typeof SERVER_FEATURES)[number]
