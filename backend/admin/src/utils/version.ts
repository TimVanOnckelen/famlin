// Compares two dot-separated numeric version strings, tolerating a leading
// "v" (e.g. release tags like "v0.1.13"). Returns a negative number if `a` is
// older than `b`, a positive number if newer, and 0 if equal. Non-numeric or
// missing segments are treated as 0, so "1.2" == "1.2.0".
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((part) => parseInt(part, 10) || 0);

  const partsA = parse(a);
  const partsB = parse(b);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
