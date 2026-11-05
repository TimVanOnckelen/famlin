"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPLICIT_BASELINE_FEATURES = void 0;
exports.serverSupports = serverSupports;
// What a server that sends no `features` array is assumed to support.
// Servers started advertising features after 0.8.7, so one without the
// field could be anything from the support-window floor (0.5.0) up to
// 0.8.7 — the baseline may therefore only hold features every server since
// 0.5.0 has. Every id above is newer than that, so the baseline is empty;
// it only grows if an id is added for a capability 0.5.0 already had.
exports.IMPLICIT_BASELINE_FEATURES = [];
// Pure check against a server-info response. `null`/`undefined` (not loaded
// yet, or the request failed) and a response without `features` (an older
// server) both fall back to IMPLICIT_BASELINE_FEATURES — unknown is treated
// as "oldest server in the window", so a feature is never offered to a
// server that might not have it.
function serverSupports(serverInfo, feature) {
    const features = serverInfo?.features ?? exports.IMPLICIT_BASELINE_FEATURES;
    return features.includes(feature);
}
