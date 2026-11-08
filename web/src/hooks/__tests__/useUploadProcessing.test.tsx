import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { api } from '@famlin/api-client'
import { createTestQueryClient } from '@/test/fixtures'
import { useUploadProcessing } from '../useUploadProcessing'

const key = '11111111-1111-4111-8111-111111111111'
const url = `/uploads/${key}.jpg`

let client: ReturnType<typeof createTestQueryClient>
beforeEach(() => {
  client = createTestQueryClient()
})
afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

it('treats a 404 from a server without the status endpoint as ready, not failed', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
  const { result } = renderHook(() => useUploadProcessing(url), { wrapper })
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(get).toHaveBeenCalledWith(`/uploads/status/${key}`)
  expect(result.current.failed).toBe(false)
  expect(result.current.pending).toBe(false)
  expect(result.current.url).toBeNull()
})

it('still reports a failure when the status request errors otherwise', async () => {
  vi.spyOn(api, 'get').mockRejectedValue(Object.assign(new Error('Server Error'), { response: { status: 500 } }))
  const { result } = renderHook(() => useUploadProcessing(url), { wrapper })
  await waitFor(() => expect(result.current.failed).toBe(true), { timeout: 3000 })
})
