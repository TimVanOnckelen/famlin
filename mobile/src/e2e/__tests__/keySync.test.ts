import { generateIdentity, publicIdentity } from '@famlin/api-client'
import { installMemoryStores } from '../testing'
import { needsRecoveryCodeBackup } from '../backupReminder'
import { computeE2eStatus } from '../status'

const KeySync = jest.requireMock('../../../modules/famlin-key-sync') as Record<string, jest.Mock>
const scope = { serverUrl: 'https://Famlin.example.com/', userId: 'alice' }

// A fake synced store shared by all the tests of this file.
let synced: Map<string, string>
beforeEach(() => {
  installMemoryStores()
  require('../keysStore').useE2eKeysStore.getState().reset()
  require('../syncRestore').resetSyncRestoreState()
  synced = new Map()
  KeySync.getItem.mockImplementation(async (key: string) => synced.get(key) ?? null)
  KeySync.setItem.mockImplementation(async (key: string, value: string) => void synced.set(key, value))
  KeySync.deleteItem.mockReset().mockResolvedValue(undefined)
})

const keySync = () => require('../keySync') as typeof import('../keySync')
const keysStore = () => require('../keysStore') as typeof import('../keysStore')

describe('native module wrapper', () => {
  it('is a quiet no-op when the native module is missing', async () => {
    let real!: typeof import('../../../modules/famlin-key-sync')
    jest.isolateModules(() => {
      jest.doMock('expo', () => ({ requireOptionalNativeModule: () => null }))
      real = jest.requireActual('../../../modules/famlin-key-sync')
    })
    expect(await real.isAvailable()).toEqual({ available: false, endToEndEncrypted: null })
    expect(await real.getItem('k')).toBeNull()
    await expect(real.setItem('k', 'v')).resolves.toBeUndefined()
    await expect(real.deleteItem('k')).resolves.toBeUndefined()
  })

  it('enforces the 1024-byte Block Store entry limit with a typed error', async () => {
    let real!: typeof import('../../../modules/famlin-key-sync')
    jest.isolateModules(() => {
      jest.doMock('expo', () => ({ requireOptionalNativeModule: () => ({ setItem: jest.fn() }) }))
      real = jest.requireActual('../../../modules/famlin-key-sync')
    })
    await expect(real.setItem('k', 'x'.repeat(1025))).rejects.toMatchObject({ code: 'too_large' })
    await expect(real.setItem('k', 'x'.repeat(1024))).resolves.toBeUndefined()
  })
})

describe('keySync', () => {
  it('stores only the latest keys under the same name whatever the server URL spelling', async () => {
    const keys = generateIdentity('alice', 2)
    expect(await keySync().syncKeysToCloud(scope, keys)).toBe(true)
    expect(await keySync().syncKeysToCloud({ ...scope, serverUrl: 'https://famlin.example.com' }, keys)).toBe(true)
    expect(synced.size).toBe(1)
    const [[name, value]] = [...synced]
    expect(name).toMatch(/^famlin_e2e_[0-9a-f]{16}$/)
    expect(JSON.parse(value)).toEqual({ v: 1, userId: 'alice', keys })
    expect(value.length).toBeLessThan(1024)
  })

  it('reports a failing store as false instead of throwing', async () => {
    KeySync.setItem.mockRejectedValueOnce(new Error('no play services'))
    expect(await keySync().syncKeysToCloud(scope, generateIdentity('alice', 1))).toBe(false)
  })

  it('only returns keys that match the identity the server publishes', async () => {
    const keys = generateIdentity('alice', 2)
    await keySync().syncKeysToCloud(scope, keys)
    expect(await keySync().readSyncedKeys(scope, publicIdentity(keys))).toEqual(keys)
    // The server moved on to another identity, or someone planted other keys.
    expect(await keySync().readSyncedKeys(scope, publicIdentity(generateIdentity('alice', 2)))).toBeNull()
    expect(await keySync().readSyncedKeys({ ...scope, userId: 'bob' }, publicIdentity(keys))).toBeNull()
  })

  it('ignores a missing or damaged item', async () => {
    const expected = publicIdentity(generateIdentity('alice', 1))
    expect(await keySync().readSyncedKeys(scope, expected)).toBeNull()
    synced.set([...synced.keys()][0] ?? 'x', '{bad')
    KeySync.getItem.mockResolvedValueOnce('{bad')
    expect(await keySync().readSyncedKeys(scope, expected)).toBeNull()
  })
})

describe('writes to the synced store', () => {
  const loadScope = async () => {
    const store = keysStore().useE2eKeysStore
    await store.getState().loadForScope(scope)
    return store
  }

  it('mirrors new keys on setup, reset and restore, but not older versions or sync restores', async () => {
    const store = await loadScope()
    const v1 = generateIdentity('alice', 1)
    const v2 = generateIdentity('alice', 2)
    await store.getState().addKeys(v1)
    await store.getState().addKeys(v2)
    await new Promise((resolve) => setImmediate(() => resolve(undefined)))
    expect(JSON.parse([...synced.values()][0]).keys.version).toBe(2)

    KeySync.setItem.mockClear()
    await store.getState().addKeys(v1) // an old version never overwrites the newest
    await store.getState().addKeys(generateIdentity('alice', 3), undefined, { skipSync: true })
    await new Promise((resolve) => setImmediate(() => resolve(undefined)))
    expect(KeySync.setItem).not.toHaveBeenCalled()
  })
})

describe('silent restore from the synced store', () => {
  const latest = generateIdentity('alice', 2)
  const run = async () => {
    const store = keysStore().useE2eKeysStore
    await store.getState().loadForScope(scope)
    const { restoreFromSyncOnce } = require('../syncRestore') as typeof import('../syncRestore')
    await restoreFromSyncOnce(scope, publicIdentity(latest))
    return store.getState().keys
  }

  it('adopts matching keys without any UI and without writing them back', async () => {
    await keySync().syncKeysToCloud(scope, latest)
    KeySync.setItem.mockClear()
    expect((await run()).map((k) => k.version)).toEqual([2])
    expect(KeySync.setItem).not.toHaveBeenCalled()
  })

  it('ignores keys that do not match the published identity, or none at all', async () => {
    expect(await run()).toEqual([])
    await keySync().syncKeysToCloud(scope, generateIdentity('alice', 2))
    require('../keysStore').useE2eKeysStore.getState().reset()
    require('../syncRestore').resetSyncRestoreState()
    expect(await run()).toEqual([])
  })

  it('keeps the status on loading until the synced store was tried, then needsRestore or ready', () => {
    const base = {
      featureSupport: 'supported' as const,
      identitiesLoading: false,
      keysLoaded: true,
      serverIdentities: [{ ...publicIdentity(latest), createdAt: '', recoveryBackup: null }],
    }
    expect(computeE2eStatus({ ...base, localKeys: [], syncChecked: false })).toBe('loading')
    expect(computeE2eStatus({ ...base, localKeys: [], syncChecked: true })).toBe('needsRestore')
    expect(computeE2eStatus({ ...base, localKeys: [latest], syncChecked: false })).toBe('ready')
  })
})

describe('recovery code reminder', () => {
  const ok = { available: true, endToEndEncrypted: true }
  it('never nags on iOS', () => {
    expect(needsRecoveryCodeBackup({ platform: 'ios', sync: undefined, hasRecoveryCode: false })).toBe(false)
    expect(
      needsRecoveryCodeBackup({
        platform: 'ios',
        sync: { available: true, endToEndEncrypted: null },
        hasRecoveryCode: false,
      })
    ).toBe(false)
  })
  it('on Android only when Block Store is not end-to-end encrypted and there is no code', () => {
    expect(needsRecoveryCodeBackup({ platform: 'android', sync: ok, hasRecoveryCode: false })).toBe(false)
    expect(needsRecoveryCodeBackup({ platform: 'android', sync: undefined, hasRecoveryCode: false })).toBe(false)
    expect(
      needsRecoveryCodeBackup({
        platform: 'android',
        sync: { available: true, endToEndEncrypted: false },
        hasRecoveryCode: false,
      })
    ).toBe(true)
    expect(
      needsRecoveryCodeBackup({
        platform: 'android',
        sync: { available: false, endToEndEncrypted: null },
        hasRecoveryCode: false,
      })
    ).toBe(true)
    expect(
      needsRecoveryCodeBackup({
        platform: 'android',
        sync: { available: false, endToEndEncrypted: null },
        hasRecoveryCode: true,
      })
    ).toBe(false)
  })
})
