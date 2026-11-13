import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../src/utils/concurrency.js'

describe('mapWithConcurrency', () => {
  it('never runs more than the limit at once and keeps input order', async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight -= 1
      return n * 2
    })
    expect(peak).toBe(3)
    expect(results).toEqual([10, 2, 8, 4, 6, 0, 12])
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 3, async () => 1)).toEqual([])
  })
})
