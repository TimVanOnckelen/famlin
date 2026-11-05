import { fetchServerInfo } from '@famlin/api-client'
import {
  checkServerFeature,
  isFeatureMarkedMissing,
  rememberNotFound,
  resetServerFeatureCache,
  retryUnlessNotFound,
} from '@/utils/serverFeatures'

let mockServerUrl: string | null = 'https://family.example'
jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  getCurrentServerUrl: () => mockServerUrl,
  fetchServerInfo: jest.fn(),
}))

beforeEach(() => {
  resetServerFeatureCache()
  jest.mocked(fetchServerInfo).mockReset()
  mockServerUrl = 'https://family.example'
})

it('reads the advertised features, fetching server-info once per server', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: ['stories'] } as never)
  await expect(checkServerFeature('stories')).resolves.toBe('supported')
  await expect(checkServerFeature('deviceDiagnostics')).resolves.toBe('unsupported')
  expect(fetchServerInfo).toHaveBeenCalledTimes(1)

  mockServerUrl = 'https://other.example'
  await checkServerFeature('stories')
  expect(fetchServerInfo).toHaveBeenCalledTimes(2)
})

it('on a server without `features`, is unknown for older ids and unsupported for deviceDiagnostics', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.8.7' } as never)
  await expect(checkServerFeature('stories')).resolves.toBe('unknown')
  await expect(checkServerFeature('deviceDiagnostics')).resolves.toBe('unsupported')
})

it('remembers a 404 per server: unknown becomes unsupported, but an advertised feature wins', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.8.7' } as never)
  const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } })
  const fetcher = rememberNotFound('stories', jest.fn().mockRejectedValue(notFound))
  await expect(fetcher()).rejects.toBe(notFound)
  expect(isFeatureMarkedMissing('stories')).toBe(true)
  await expect(checkServerFeature('stories')).resolves.toBe('unsupported')
  await expect(checkServerFeature('circles')).resolves.toBe('unknown')

  // Another server has its own record.
  mockServerUrl = 'https://other.example'
  expect(isFeatureMarkedMissing('stories')).toBe(false)
  await expect(checkServerFeature('stories')).resolves.toBe('unknown')

  // Upgraded and advertising the feature: the old 404 no longer matters.
  mockServerUrl = 'https://family.example'
  resetServerFeatureCache()
  await expect(fetcher()).rejects.toBe(notFound)
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: ['stories'] } as never)
  await expect(checkServerFeature('stories')).resolves.toBe('supported')
})

it('does not record other failures', async () => {
  const fetcher = rememberNotFound('stories', jest.fn().mockRejectedValue({ response: { status: 500 } }))
  await expect(fetcher()).rejects.toEqual({ response: { status: 500 } })
  expect(isFeatureMarkedMissing('stories')).toBe(false)
})

it('is unknown, without throwing, on a failed request, and retries next time', async () => {
  jest.mocked(fetchServerInfo).mockRejectedValueOnce(new Error('offline'))
  await expect(checkServerFeature('stories')).resolves.toBe('unknown')
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: ['stories'] } as never)
  await expect(checkServerFeature('stories')).resolves.toBe('supported')
})

it('is unknown with no server configured', async () => {
  mockServerUrl = null
  await expect(checkServerFeature('stories')).resolves.toBe('unknown')
  expect(fetchServerInfo).not.toHaveBeenCalled()
})

it('never retries a 404, but retries other failures', () => {
  expect(retryUnlessNotFound(0, { response: { status: 404 } })).toBe(false)
  expect(retryUnlessNotFound(0, { response: { status: 500 } })).toBe(true)
  expect(retryUnlessNotFound(3, new Error('network'))).toBe(false)
})
