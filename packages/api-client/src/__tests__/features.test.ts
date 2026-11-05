import { describe, expect, it } from 'vitest'
import type { ServerInfo } from '../auth'
import { IMPLICIT_BASELINE_FEATURES, serverSupports } from '../features'

describe('serverSupports', () => {
  it('reads the features a server advertises', () => {
    const info: ServerInfo = { version: '0.9.0', features: ['uploadProcessing', 'someFutureFeature'] }
    expect(serverSupports(info, 'uploadProcessing')).toBe(true)
    expect(serverSupports(info, 'livePhotos')).toBe(false)
  })

  it('falls back to the implicit baseline for a server without a features field', () => {
    const info: ServerInfo = { version: '0.8.7' }
    expect(serverSupports(info, 'uploadProcessing')).toBe(false)
    expect(serverSupports(info, 'livePhotos')).toBe(false)
  })

  it('treats server-info that has not loaded yet as the baseline', () => {
    expect(serverSupports(undefined, 'uploadProcessing')).toBe(false)
    expect(serverSupports(null, 'stories')).toBe(false)
  })

  it('keeps the baseline empty: every feature id postdates the 0.5.0 window floor', () => {
    expect(IMPLICIT_BASELINE_FEATURES).toEqual([])
  })
})
