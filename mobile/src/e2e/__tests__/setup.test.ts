import { installMemoryStores } from '../testing'

const mockPublish = jest.fn()
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  publishE2eIdentity: (...args: unknown[]) => mockPublish(...args),
}))

const scope = { serverUrl: 'http://example.com', userId: 'alice' }
const queryClient = { invalidateQueries: jest.fn().mockResolvedValue(undefined) } as any

async function load() {
  const { useE2eKeysStore } = require('../keysStore')
  const { createIdentity } = require('../actions')
  await useE2eKeysStore.getState().loadForScope(scope)
  return { useE2eKeysStore, createIdentity }
}

describe('silent identity setup', () => {
  beforeEach(() => {
    jest.resetModules()
    mockPublish.mockReset()
    installMemoryStores()
  })

  it('publishes version 1 without a recovery backup and keeps the keys locally', async () => {
    mockPublish.mockResolvedValue({})
    const { useE2eKeysStore, createIdentity } = await load()

    await createIdentity({ userId: 'alice', serverIdentities: [], queryClient })

    expect(mockPublish).toHaveBeenCalledTimes(1)
    const body = mockPublish.mock.calls[0][0]
    expect(body.version).toBe(1)
    expect(body).not.toHaveProperty('recoveryBackup')
    expect(useE2eKeysStore.getState().keys.map((k: any) => k.version)).toEqual([1])
    expect(useE2eKeysStore.getState().recovery).toBeNull()
  })

  it('publishes latest + 1 on a reset and keeps the old keys', async () => {
    mockPublish.mockResolvedValue({})
    const { useE2eKeysStore, createIdentity } = await load()
    await createIdentity({ userId: 'alice', serverIdentities: [], queryClient })
    await createIdentity({
      userId: 'alice',
      serverIdentities: [{ version: 1, signPublicKey: 's', boxPublicKey: 'b', createdAt: '', recoveryBackup: null }],
      queryClient,
    })
    expect(mockPublish.mock.calls[1][0].version).toBe(2)
    expect(useE2eKeysStore.getState().keys.map((k: any) => k.version)).toEqual([2, 1])
  })

  it('shares one request between concurrent opens', async () => {
    let release!: () => void
    mockPublish.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const { createIdentity } = await load()

    const first = createIdentity({ userId: 'alice', serverIdentities: [], queryClient })
    const second = createIdentity({ userId: 'alice', serverIdentities: [], queryClient })
    release()
    await Promise.all([first, second])

    expect(mockPublish).toHaveBeenCalledTimes(1)
  })

  it('on a 409 keeps no keys, refetches identities and does not retry', async () => {
    mockPublish.mockRejectedValue({ response: { status: 409 } })
    const { useE2eKeysStore, createIdentity } = await load()
    queryClient.invalidateQueries.mockClear()

    await expect(createIdentity({ userId: 'alice', serverIdentities: [], queryClient })).rejects.toBeDefined()

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(useE2eKeysStore.getState().keys).toEqual([])
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
    // With the other device's identity now on the server and no local keys: restore, not setup.
    const { computeE2eStatus } = require('../status')
    expect(
      computeE2eStatus({
        featureSupport: 'supported',
        identitiesLoading: false,
        keysLoaded: true,
        serverIdentities: [{ version: 1, signPublicKey: 's', boxPublicKey: 'b', createdAt: '', recoveryBackup: null }],
        localKeys: useE2eKeysStore.getState().keys,
      })
    ).toBe('needsRestore')
  })
})
