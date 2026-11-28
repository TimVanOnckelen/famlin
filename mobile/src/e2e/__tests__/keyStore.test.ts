import { generateIdentity } from '@famlin/api-client'
import { installMemoryStores } from '../testing'
import {
  loadKeys,
  loadMeta,
  loadRecoveryCode,
  saveKeys,
  saveMeta,
  saveRecoveryCode,
  scopeId,
  wipeScope,
} from '../keyStore'

const alice = { serverUrl: 'https://famlin.example.com', userId: 'alice' }
const aliceOtherServer = { serverUrl: 'https://other.example.com', userId: 'alice' }
const bob = { serverUrl: 'https://famlin.example.com', userId: 'bob' }

describe('e2e key store', () => {
  let stores: ReturnType<typeof installMemoryStores>
  beforeEach(() => {
    stores = installMemoryStores()
  })

  it('derives SecureStore-safe, per server and account ids', () => {
    expect(scopeId(alice)).toMatch(/^[0-9a-f]{16}$/)
    expect(scopeId(alice)).toBe(scopeId({ serverUrl: 'HTTPS://famlin.example.com/', userId: 'alice' }))
    expect(new Set([scopeId(alice), scopeId(aliceOtherServer), scopeId(bob)]).size).toBe(3)
    for (const key of stores.secure.keys()) expect(key).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('keeps every identity version per scope and never mixes accounts or servers', async () => {
    const v1 = generateIdentity('alice', 1)
    const v2 = generateIdentity('alice', 2)
    await saveKeys(alice, v1)
    await saveKeys(alice, v2)
    await saveKeys(bob, generateIdentity('bob', 1))

    expect((await loadKeys(alice)).map((keys) => keys.version)).toEqual([2, 1])
    expect(await loadKeys(aliceOtherServer)).toEqual([])
    expect((await loadKeys(bob)).map((keys) => keys.userId)).toEqual(['bob'])
    for (const value of stores.secure.values()) expect(value.length).toBeLessThan(2048)
  })

  it('stores the recovery code and contact pins per scope', async () => {
    await saveRecoveryCode(alice, { code: 'AAAA-BBBB', confirmed: false })
    await saveMeta(alice, { contacts: { bob: { version: 1, signPublicKey: 'k', acknowledged: true } } })

    expect(await loadRecoveryCode(alice)).toEqual({ code: 'AAAA-BBBB', confirmed: false })
    expect(await loadRecoveryCode(bob)).toBeNull()
    expect((await loadMeta(alice)).contacts.bob.version).toBe(1)
    expect(await loadMeta(bob)).toEqual({ contacts: {} })
  })

  it('wipes only the given scope', async () => {
    await saveKeys(alice, generateIdentity('alice', 1))
    await saveRecoveryCode(alice, { code: 'X', confirmed: true })
    await saveMeta(alice, { contacts: {} })
    await saveKeys(aliceOtherServer, generateIdentity('alice', 1))

    await wipeScope(alice)

    expect(await loadKeys(alice)).toEqual([])
    expect(await loadRecoveryCode(alice)).toBeNull()
    expect(await loadKeys(aliceOtherServer)).toHaveLength(1)
  })

  it('skips a damaged entry instead of throwing', async () => {
    await saveKeys(alice, generateIdentity('alice', 1))
    for (const key of stores.secure.keys()) if (key.endsWith('_k1')) stores.secure.set(key, '{not json')
    expect(await loadKeys(alice)).toEqual([])
  })
})
