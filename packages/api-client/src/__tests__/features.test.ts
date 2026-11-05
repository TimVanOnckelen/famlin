import { describe, expect, it } from 'vitest'
import type { ServerInfo } from '../auth'
import {
  IMPLICIT_BASELINE_FEATURES,
  PRE_FEATURE_LIST_FEATURES,
  isNotFoundError,
  serverFeatureSupport,
  serverSupports,
} from '../features'

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

describe('serverFeatureSupport', () => {
  it('is supported/unsupported when the server sends a features list', () => {
    const info: ServerInfo = { version: '0.9.0', features: ['stories'] }
    expect(serverFeatureSupport(info, 'stories')).toBe('supported')
    expect(serverFeatureSupport(info, 'circles')).toBe('unsupported')
    expect(serverFeatureSupport({ version: '0.9.0', features: [] }, 'circles')).toBe('unsupported')
  })

  it('is unknown for a server without a features field, or before server-info loads', () => {
    expect(serverFeatureSupport({ version: '0.8.7' }, 'stories')).toBe('unknown')
    expect(serverFeatureSupport(undefined, 'stories')).toBe('unknown')
    expect(serverFeatureSupport(null, 'stories')).toBe('unknown')
  })

  it('is unknown on a featureless server for every id that predates the features list', () => {
    for (const feature of PRE_FEATURE_LIST_FEATURES) {
      expect(serverFeatureSupport({ version: '0.8.7' }, feature)).toBe('unknown')
    }
  })

  it('is unsupported on a featureless server for ids that shipped with or after the features list', () => {
    // deviceDiagnostics shipped in the same release as `features`, so a
    // server without the field definitely lacks it.
    expect(PRE_FEATURE_LIST_FEATURES).not.toContain('deviceDiagnostics')
    expect(serverFeatureSupport({ version: '0.8.7' }, 'deviceDiagnostics')).toBe('unsupported')
    expect(serverSupports({ version: '0.8.7' }, 'deviceDiagnostics')).toBe(false)
  })

  it('stays unknown for every id before server-info loads', () => {
    expect(serverFeatureSupport(undefined, 'deviceDiagnostics')).toBe('unknown')
  })
})

describe('isNotFoundError', () => {
  it('matches only an HTTP 404', () => {
    expect(isNotFoundError({ response: { status: 404 } })).toBe(true)
    expect(isNotFoundError({ response: { status: 500 } })).toBe(false)
    expect(isNotFoundError(new Error('network'))).toBe(false)
    expect(isNotFoundError(undefined)).toBe(false)
  })
})
