// Runs fn over items with at most `limit` calls in flight at once, in input
// order. Like Promise.all, but bounded: used where an unbounded fan-out would
// overwhelm a downstream service (e.g. SMTP servers capping concurrent
// connections per client). fn should handle its own errors; a rejection
// stops further items from starting and is rethrown.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
