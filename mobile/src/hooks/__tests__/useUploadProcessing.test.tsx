import React from 'react'
import { renderHook, waitFor, act } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api, fetchServerInfo, fetchUploadProcessing, type UploadProcessing } from '@famlin/api-client'
import { UploadProcessingContext, useUploadProcessing } from '../useUploadProcessing'

jest.mock('@famlin/api-client', () => ({
  ...jest.requireActual('@famlin/api-client'),
  uploadKey: () => 'photo-key',
  fetchUploadProcessing: jest.fn(),
  fetchServerInfo: jest.fn(),
}))

const url = '/uploads/photo.jpg'
const ready: UploadProcessing = { status: 'ready', kind: 'image', url, thumbnailUrl: null }
let client: QueryClient
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.9.0', features: ['uploadProcessing'] })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
})
afterEach(() => {
  client.clear()
  jest.restoreAllMocks()
})

function wrapper(state?: UploadProcessing) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <UploadProcessingContext.Provider value={state ? { 'photo-key': state } : undefined}>
          {children}
        </UploadProcessingContext.Provider>
      </QueryClientProvider>
    )
  }
}

it.each(['ready', 'failed'] as const)('uses %s post metadata without a status request', async (status) => {
  const { result } = await renderHook(() => useUploadProcessing(url), { wrapper: wrapper({ ...ready, status }) })
  expect(result.current.status).toBe(status)
  expect(result.current.pending).toBe(false)
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
})

it('polls pending metadata and stops once ready', async () => {
  jest.useFakeTimers()
  try {
    jest.mocked(fetchUploadProcessing).mockResolvedValue(ready)
    const { result } = await renderHook(() => useUploadProcessing(url), {
      wrapper: wrapper({ ...ready, status: 'queued' }),
    })
    expect(result.current.pending).toBe(true)
    expect(fetchUploadProcessing).not.toHaveBeenCalled()
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000)
    })
    expect(fetchUploadProcessing).toHaveBeenCalledTimes(1)
  } finally {
    jest.useRealTimers()
  }
})

it('fetches status without post metadata when the server advertises uploadProcessing', async () => {
  jest.mocked(fetchUploadProcessing).mockResolvedValue(ready)
  const { result } = await renderHook(() => useUploadProcessing(url), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(fetchUploadProcessing).toHaveBeenCalledTimes(1)
})

it('treats a 404 from the status endpoint as ready, not failed', async () => {
  // Run the real fetchUploadProcessing so its 404 mapping is what's exercised.
  jest.mocked(fetchUploadProcessing).mockImplementation(jest.requireActual('@famlin/api-client').fetchUploadProcessing)
  const get = jest
    .spyOn(api, 'get')
    .mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
  const { result } = await renderHook(() => useUploadProcessing(url), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(get).toHaveBeenCalledWith('/uploads/status/photo-key')
  expect(result.current.failed).toBe(false)
  expect(result.current.pending).toBe(false)
  expect(result.current.url).toBeNull()
})

it('never calls the status endpoint on a server without uploadProcessing (issue #380)', async () => {
  // No `features` field at all: an older server, implicit baseline.
  jest.mocked(fetchServerInfo).mockResolvedValue({ version: '0.8.6' })
  const { result } = await renderHook(() => useUploadProcessing(url), { wrapper: wrapper() })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.pending).toBe(false)
  expect(result.current.failed).toBe(false)
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
})

it('waits for server-info before asking for status, showing the upload as pending', async () => {
  jest.mocked(fetchServerInfo).mockReturnValue(new Promise(() => {}))
  const { result } = await renderHook(() => useUploadProcessing(url), { wrapper: wrapper() })
  expect(result.current.pending).toBe(true)
  expect(fetchUploadProcessing).not.toHaveBeenCalled()
})

it('trusts post metadata as proof of support before server-info has loaded', async () => {
  jest.mocked(fetchServerInfo).mockReturnValue(new Promise(() => {}))
  const { result } = await renderHook(() => useUploadProcessing(url), {
    wrapper: wrapper({ ...ready, kind: 'livePhoto', videoUrl: '/uploads/clip.mov' }),
  })
  expect(result.current.kind).toBe('livePhoto')
  expect(result.current.videoUrl).toBe('/uploads/clip.mov')
  expect(result.current.pending).toBe(false)
})
