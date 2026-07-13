"use strict";
// Small, dependency-free semver-ish comparator used to gate mobile's
// "update required" screen against the server's minAppVersion
// (see fetchServerInfo() in ./auth). Deliberately not a full semver parser —
// Famlin's own version strings are plain dot-separated numeric segments
// (optionally prefixed with 'v'), so this only needs to handle that shape
// plus tolerate whatever a differently-behaved server might send back.
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareVersions = compareVersions;
/**
 * Compare two dot-separated numeric version strings (e.g. "1.2.10"),
 * tolerating a leading "v" (e.g. "v1.2.10"), differing numbers of segments
 * (missing segments are treated as 0), and non-numeric segments (treated as
 * 0 rather than throwing).
 *
 * @returns a negative number if `a` < `b`, zero if they're equal, and a
 * positive number if `a` > `b` — the same contract as `Array.prototype.sort`
 * comparators and `String.prototype.localeCompare`.
 */
function compareVersions(a, b) {
    const partsA = parseVersion(a);
    const partsB = parseVersion(b);
    const length = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < length; i++) {
        const segmentA = partsA[i] ?? 0;
        const segmentB = partsB[i] ?? 0;
        if (segmentA !== segmentB) {
            return segmentA - segmentB;
        }
    }
    return 0;
}
function parseVersion(version) {
    const withoutPrefix = version.trim().replace(/^v/i, '');
    return withoutPrefix.split('.').map((segment) => {
        const parsed = parseInt(segment, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    });
}
