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
export declare function compareVersions(a: string, b: string): number;
