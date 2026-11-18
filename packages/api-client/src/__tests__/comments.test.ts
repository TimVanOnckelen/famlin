import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Comment } from '../types'

vi.mock('../client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const comment = (id: string, createdAt: string): Comment =>
  ({ id, postId: 'post-1', createdAt, content: id, likeCount: 0 }) as unknown as Comment

describe('comments paging (issue #130)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests a page and passes the paged response through', async () => {
    const client = await import('../client.js')
    const page = { items: [comment('c1', '2026-01-01T00:00:00.000Z')], nextCursor: 'next' }
    ;(client.api.get as any).mockResolvedValue({ data: page })

    const { fetchCommentsPage } = await import('../comments.js')
    expect(await fetchCommentsPage('post-1', { cursor: 'abc' })).toEqual(page)
    expect(client.api.get).toHaveBeenCalledWith('/posts/post-1/comments', { params: { take: 30, cursor: 'abc' } })
  })

  it('treats an older server’s bare array as one final page', async () => {
    const client = await import('../client.js')
    const all = [comment('c1', '2026-01-01T00:00:00.000Z')]
    ;(client.api.get as any).mockResolvedValue({ data: all })

    const { fetchCommentsPage } = await import('../comments.js')
    expect(await fetchCommentsPage('post-1')).toEqual({ items: all, nextCursor: null })
  })

  it('flattens pages oldest-first without duplicates', async () => {
    const { flattenCommentPages } = await import('../comments.js')
    const newer = comment('c2', '2026-01-02T00:00:00.000Z')
    const older = comment('c1', '2026-01-01T00:00:00.000Z')
    const flat = flattenCommentPages([
      { items: [newer], nextCursor: 'x' },
      { items: [older, newer], nextCursor: null },
    ])
    expect(flat.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('patches and adds comments in both the flat and the paged cache', async () => {
    const { addCommentToCaches, patchCommentInCaches, pagedCommentsQueryKey } = await import('../comments.js')
    const qc = new QueryClient()
    const c1 = comment('c1', '2026-01-01T00:00:00.000Z')
    qc.setQueryData(['comments', 'post-1'], [c1])
    qc.setQueryData(pagedCommentsQueryKey('post-1'), {
      pages: [{ items: [c1], nextCursor: null }],
      pageParams: [null],
    })

    patchCommentInCaches(qc, 'post-1', 'c1', (c) => ({ ...c, likeCount: 1 }))
    addCommentToCaches(qc, 'post-1', comment('c2', '2026-01-02T00:00:00.000Z'))

    expect(qc.getQueryData<Comment[]>(['comments', 'post-1'])!.map((c) => [c.id, c.likeCount])).toEqual([
      ['c1', 1],
      ['c2', 0],
    ])
    const paged = qc.getQueryData<{ pages: { items: Comment[] }[] }>(pagedCommentsQueryKey('post-1'))!
    expect(paged.pages[0].items.map((c) => [c.id, c.likeCount])).toEqual([
      ['c2', 0],
      ['c1', 1],
    ])
  })
})
