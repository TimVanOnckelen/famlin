import { Platform } from 'react-native'
import Constants from 'expo-constants'

import { isIosFreeTeamBuild } from '../iosFreeTeam'
import { isAppleSignInAvailable } from '../appleLogin'

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => true),
}))

jest.mock('@/api/auth', () => ({
  getCurrentServerUrl: jest.fn(),
  loginWithApple: jest.fn(),
}))

const config = Constants.expoConfig as { extra?: Record<string, unknown> }

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os })
}

afterEach(() => {
  delete config.extra
  setPlatform('ios')
})

describe('isIosFreeTeamBuild', () => {
  it('is false for a normal build', () => {
    setPlatform('ios')
    expect(isIosFreeTeamBuild()).toBe(false)
  })

  it('is true on iOS when app.config.js set extra.iosFreeTeam', () => {
    setPlatform('ios')
    config.extra = { iosFreeTeam: true }
    expect(isIosFreeTeamBuild()).toBe(true)
  })

  it('never applies to Android', () => {
    setPlatform('android')
    config.extra = { iosFreeTeam: true }
    expect(isIosFreeTeamBuild()).toBe(false)
  })
})

describe('isAppleSignInAvailable', () => {
  it('hides Sign in with Apple in a free-team build', async () => {
    setPlatform('ios')
    expect(await isAppleSignInAvailable()).toBe(true)
    config.extra = { iosFreeTeam: true }
    expect(await isAppleSignInAvailable()).toBe(false)
  })
})
