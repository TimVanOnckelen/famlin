"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRE_FEATURE_LIST_FEATURES = exports.IMPLICIT_BASELINE_FEATURES = void 0;
exports.serverSupports = serverSupports;
exports.serverFeatureSupport = serverFeatureSupport;
exports.isNotFoundError = isNotFoundError;
// What a server that sends no `features` array is known to support.
// Servers started advertising features after 0.8.7, so one without the
// field could be anything from the support-window floor (0.5.0) up to
// 0.8.7 — the baseline may therefore only hold features every server since
// 0.5.0 has. Every id above is newer than that, so the baseline is empty;
// it only grows if an id is added for a capability 0.5.0 already had.
// The rest split in two: ids in PRE_FEATURE_LIST_FEATURES below may exist
// on such a server without it saying so (a 0.8.7 server has stories,
// circles, gift lists and upload processing), so they are "unknown" there —
// clients try the endpoint and treat a 404 as unsupported. Every other id
// is "unsupported" there (see serverFeatureSupport() below).
exports.IMPLICIT_BASELINE_FEATURES = [];
// Ids whose capability shipped *before* the release that introduced the
// `features` field (i.e. in 0.8.7 or earlier), so a server without the
// field may or may not have them: "unknown" there. Any id not listed here
// shipped in or after that release, so a server without `features`
// definitely lacks it: "unsupported", and clients never send a request
// that would only 404. Closed list — never add to it: a new id is
// automatically "unsupported" on featureless servers, with no extra step.
exports.PRE_FEATURE_LIST_FEATURES = [
    'accountDeletion',
    'circles',
    'stories',
    'memberExport',
    'giftLists',
    'uploadProcessing',
    'livePhotos',
];
// Strict check against a server-info response: true only when the server
// advertises the feature (or it's in the implicit baseline). `null`/
// `undefined` (not loaded yet, or the request failed) and a response
// without `features` (an older server) both count as not advertised. Use
// serverFeatureSupport() to decide whether to *offer* a feature — this is
// false on servers that may well have it.
function serverSupports(serverInfo, feature) {
    return serverFeatureSupport(serverInfo, feature) === 'supported';
}
// Three-state check, the one clients gate UI on:
// - 'supported': the server lists the feature (or it's in the baseline).
// - 'unsupported': the server sends a `features` list without it — hide
//   the feature and never call its endpoints.
// - 'unknown': server-info hasn't loaded/failed, or the server predates the
//   `features` field (0.8.7 and older) and the feature is one such a server
//   may have (PRE_FEATURE_LIST_FEATURES). Try the feature anyway, and treat
//   a 404 from its endpoint (isNotFoundError) as unsupported: hide it, no
//   retry. On a server without `features`, any other id is 'unsupported'.
function serverFeatureSupport(serverInfo, feature) {
    if (exports.IMPLICIT_BASELINE_FEATURES.includes(feature))
        return 'supported';
    if (!serverInfo)
        return 'unknown';
    if (!Array.isArray(serverInfo.features)) {
        return exports.PRE_FEATURE_LIST_FEATURES.includes(feature) ? 'unknown' : 'unsupported';
    }
    return serverInfo.features.includes(feature) ? 'supported' : 'unsupported';
}
// Whether a request failed with a 404 — the "unknown" fallback's signal
// that an older server doesn't have the endpoint at all.
function isNotFoundError(error) {
    return error?.response?.status === 404;
}
