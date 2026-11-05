import { fetchServerInfo } from '@famlin/api-client'
import { checkServerSupports, resetServerFeatureCache } from '@/utils/serverFeatures'

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
  await expect(checkServerSupports('stories')).resolves.toBe(true)
  await expect(checkServerSupports('deviceDiagnostics')).resolves.toBe(false)
  expect(fetchServerInfo).toHaveBeenCalledTimes(1)

  mockServerUrl = 'https://other.example'
  await checkServerSupports('stories')
  expect(fetchServerInfo).toHaveBeenCalledTimes(2)
})

it('treats a server without `features` as the baseline', async () => {
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.5.0' } as never)
  await expect(checkServerSupports('deviceDiagnostics')).resolves.toBe(false)
})

it('returns false without throwing on a failed request, and retries next time', async () => {
  jest.mocked(fetchServerInfo).mockRejectedValueOnce(new Error('offline'))
  await expect(checkServerSupports('stories')).resolves.toBe(false)
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: ['stories'] } as never)
  await expect(checkServerSupports('stories')).resolves.toBe(true)
})

it('returns false with no server configured', async () => {
  mockServerUrl = null
  await expect(checkServerSupports('stories')).resolves.toBe(false)
  expect(fetchServerInfo).not.toHaveBeenCalled()
})
