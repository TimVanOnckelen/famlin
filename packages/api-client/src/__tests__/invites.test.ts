import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '../client'
import { acceptInvite, fetchInvitePreview, registerViaInvite } from '../invites'
vi.mock('../client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.get).mockResolvedValue({ data: { status: 'not_found' } })
  vi.mocked(api.post).mockResolvedValue({ data: {} })
})
it('keeps an untrusted token within one URL segment for all invitation requests', async () => {
  const token = 'a/../other?x=#'
  const encoded = encodeURIComponent(token)
  await fetchInvitePreview(token)
  expect(api.get).toHaveBeenCalledWith(`/invites/${encoded}`)
  const data = { name: 'Member', email: 'member@example.com', password: 'password123' }
  await registerViaInvite(token, data)
  expect(api.post).toHaveBeenCalledWith(`/invites/${encoded}/register`, data)
  await acceptInvite(token)
  expect(api.post).toHaveBeenCalledWith(`/invites/${encoded}/accept`)
})
