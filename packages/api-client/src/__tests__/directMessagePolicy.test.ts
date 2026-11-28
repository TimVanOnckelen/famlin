import { describe, expect, it } from 'vitest'
import { resolveDirectMessagePolicy } from '../auth'

describe('resolveDirectMessagePolicy', () => {
  it('uses the server policy when present', () => {
    const policy = { enabled: true, web: false, encryption: false }
    expect(resolveDirectMessagePolicy({ version: '1', directMessages: policy })).toEqual(policy)
  })

  it('falls back to the advertised features on older servers', () => {
    expect(resolveDirectMessagePolicy({ version: '1', features: ['directMessages', 'e2eDirectMessages'] })).toEqual({
      enabled: true,
      web: true,
      encryption: true,
    })
    expect(resolveDirectMessagePolicy({ version: '1', features: ['directMessages'] })).toEqual({
      enabled: true,
      web: true,
      encryption: false,
    })
    expect(resolveDirectMessagePolicy(null)).toEqual({ enabled: false, web: false, encryption: false })
  })
})
