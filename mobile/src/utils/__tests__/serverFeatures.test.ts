import { fetchServerInfo } from '@famlin/api-client'
import { checkServerFeature, resetServerFeatureCache, retryUnlessNotFound } from '@/utils/serverFeatures'

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

it('is unknown on a server without `features`', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.8.7' } as never)
  await expect(checkServerFeature('deviceDiagnostics')).resolves.toBe('unknown')
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
