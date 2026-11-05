import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  MIN_SERVER_VERSION,
  dismissOldServerBanner,
  getDismissedServerVersion,
  isServerTooOld,
  shouldShowOldServerBanner,
} from '@/utils/serverVersion'

describe('isServerTooOld', () => {
  it('is true below the minimum', () => {
    expect(isServerTooOld('0.4.9', '0.5.0')).toBe(true)
    expect(isServerTooOld('v0.4.12', '0.5.0')).toBe(true)
  })

  it('is false at or above the minimum', () => {
    expect(isServerTooOld('0.5.0', '0.5.0')).toBe(false)
    expect(isServerTooOld('0.5', '0.5.0')).toBe(false)
    expect(isServerTooOld('0.10.0', '0.5.0')).toBe(false)
  })

  it('is false for a missing or unparseable version', () => {
    expect(isServerTooOld(undefined)).toBe(false)
    expect(isServerTooOld(null)).toBe(false)
    expect(isServerTooOld('')).toBe(false)
    expect(isServerTooOld('dev')).toBe(false)
    expect(isServerTooOld('0.4.0-beta')).toBe(false)
  })

  it('uses MIN_SERVER_VERSION by default', () => {
    expect(MIN_SERVER_VERSION).toBe('0.5.0')
    expect(isServerTooOld('0.4.0')).toBe(true)
    expect(isServerTooOld('0.5.0')).toBe(false)
  })
})

describe('shouldShowOldServerBanner', () => {
  it('shows for an old server that was never dismissed', () => {
    expect(shouldShowOldServerBanner('0.4.0', null, '0.5.0')).toBe(true)
  })

  it('hides for a supported server', () => {
    expect(shouldShowOldServerBanner('0.5.0', null, '0.5.0')).toBe(false)
    expect(shouldShowOldServerBanner('0.6.1', null, '0.5.0')).toBe(false)
  })

  it('hides once dismissed for this version', () => {
    expect(shouldShowOldServerBanner('0.4.0', '0.4.0', '0.5.0')).toBe(false)
  })

  it('shows again for a new (still too old) version after a dismissal', () => {
    expect(shouldShowOldServerBanner('0.4.1', '0.4.0', '0.5.0')).toBe(true)
  })

  it('hides for a missing version', () => {
    expect(shouldShowOldServerBanner(undefined, null, '0.5.0')).toBe(false)
  })
})

describe('dismissal storage', () => {
  beforeEach(() => AsyncStorage.clear())

  it('is keyed by server URL and stores the dismissed version', async () => {
    await dismissOldServerBanner('https://a.example', '0.4.0')
    expect(await getDismissedServerVersion('https://a.example')).toBe('0.4.0')
    expect(await getDismissedServerVersion('https://b.example')).toBeNull()
  })
})
