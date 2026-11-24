import { generateIdentity } from '@famlin/api-client'
import { installMemoryStores } from '../testing'

jest.mock('@/utils/storage', () => ({
  setToken: jest.fn().mockResolvedValue(undefined),
  deleteToken: jest.fn().mockResolvedValue(undefined),
  getToken: jest.fn().mockResolvedValue(null),
  setServerUrl: jest.fn().mockResolvedValue(undefined),
  deleteServerUrl: jest.fn().mockResolvedValue(undefined),
  getPushToken: jest.fn().mockResolvedValue(null),
  deletePushToken: jest.fn().mockResolvedValue(undefined),
  getDeviceInstallId: jest.fn().mockResolvedValue(null),
  deleteDeviceReport: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/api/uploads', () => ({ refreshMediaToken: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  setApiBaseUrl: jest.fn(),
  setMediaToken: jest.fn(),
  unregisterPushToken: jest.fn().mockResolvedValue(undefined),
  unregisterDevice: jest.fn().mockResolvedValue(undefined),
}))

const user = {
  id: 'alice',
  email: 'a@example.com',
  name: 'Alice',
  isAdmin: false,
  hasPassword: true,
  emailOnNewPost: true,
  emailOnNewComment: true,
  emailOnNewLike: true,
  pushOnNewPost: true,
  pushOnNewComment: true,
  pushOnNewLike: true,
}
const scope = { serverUrl: 'http://example.com', userId: 'alice' }

describe('end-to-end keys across sign-out', () => {
  beforeEach(() => {
    jest.resetModules()
    installMemoryStores()
  })

  async function signedInWithKeys() {
    const { useAuthStore } = require('@/stores/authStore')
    const { useE2eKeysStore } = require('@/e2e/keysStore')
    const keyStore = require('@/e2e/keyStore')
    await useAuthStore.getState().setAuth(user, 'token', scope.serverUrl)
    await useE2eKeysStore.getState().loadForScope(scope)
    await useE2eKeysStore.getState().addKeys(generateIdentity('alice', 1), { code: 'CODE', confirmed: true })
    return { useAuthStore, useE2eKeysStore, keyStore }
  }

  it('keeps the keys when the session just expires (clearSession)', async () => {
    const { useAuthStore, keyStore } = await signedInWithKeys()
    await useAuthStore.getState().clearSession()
    expect(await keyStore.loadKeys(scope)).toHaveLength(1)
    expect(await keyStore.loadRecoveryCode(scope)).not.toBeNull()
  })

  it('wipes keys, recovery code, pins and the in-memory copy on logout', async () => {
    const { useAuthStore, useE2eKeysStore, keyStore } = await signedInWithKeys()
    await useE2eKeysStore.getState().setContactPin('bob', { version: 1, signPublicKey: 'k', acknowledged: true })

    await useAuthStore.getState().logout()

    expect(await keyStore.loadKeys(scope)).toEqual([])
    expect(await keyStore.loadRecoveryCode(scope)).toBeNull()
    expect(await keyStore.loadMeta(scope)).toEqual({ contacts: {} })
    expect(useE2eKeysStore.getState().keys).toEqual([])
  })
})
