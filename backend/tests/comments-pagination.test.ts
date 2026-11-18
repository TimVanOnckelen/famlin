import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { buildTestApp, createUser, createGroupWithMember, createPost, authHeader } from './helpers.js'

// GET /api/posts/:postId/comments?take=&cursor= (issue #130): newest
// top-level comments first, each page carrying whole reply threads; the
// legacy bare array when neither param is sent.

const base = Date.UTC(2026, 0, 1)
const at = (minutes: number) => new Date(base + minutes * 60_000)

async function comment(data: {
  postId: string
  authorId: string
  minute: number
  parentId?: string
  assetUrl?: string
  metadata?: object
}) {
  return prisma.comment.create({
    data: {
      postId: data.postId,
      authorId: data.authorId,
      content: `c${data.minute}`,
      parentId: data.parentId,
      assetUrl: data.assetUrl,
      metadata: data.metadata,
      createdAt: at(data.minute),
    },
  })
}

describe('paginated comments', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  async function get(postId: string, user: Parameters<typeof authHeader>[0], query = '') {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}/comments${query}`,
      headers: authHeader(user),
    })
    expect(res.statusCode).toBe(200)
    return res.json()
  }

  it('keeps the bare array when neither take nor cursor is sent', async () => {
    const user = await createUser()
    const group = await createGroupWithMember(user)
    const post = await createPost({ groupId: group.id, authorId: user.id })
    await comment({ postId: post.id, authorId: user.id, minute: 1 })
    await comment({ postId: post.id, authorId: user.id, minute: 2 })

    const body = await get(post.id, user)
    expect(Array.isArray(body)).toBe(true)
    expect(body.map((c: { content: string }) => c.content)).toEqual(['c1', 'c2'])
  })

  it('pages top-level threads newest-first, with every reply on its parent’s page', async () => {
    const user = await createUser()
    const group = await createGroupWithMember(user)
    const post = await createPost({ groupId: group.id, authorId: user.id })
    const t1 = await comment({ postId: post.id, authorId: user.id, minute: 1 })
    const t2 = await comment({ postId: post.id, authorId: user.id, minute: 2 })
    await comment({ postId: post.id, authorId: user.id, minute: 3 })
    // A late reply (and a reply to it) on the oldest thread stays with it.
    const r1 = await comment({ postId: post.id, authorId: user.id, minute: 10, parentId: t1.id })
    await comment({ postId: post.id, authorId: user.id, minute: 11, parentId: r1.id })
    await comment({ postId: post.id, authorId: user.id, minute: 4, parentId: t2.id })

    const first = await get(post.id, user, '?take=2')
    expect(first.items.map((c: { content: string }) => c.content)).toEqual(['c4', 'c3', 'c2'])
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = await get(post.id, user, `?take=2&cursor=${first.nextCursor}`)
    expect(second.items.map((c: { content: string }) => c.content)).toEqual(['c11', 'c10', 'c1'])
    expect(second.nextCursor).toBeNull()
  })

  it('survives the cursor comment being deleted', async () => {
    const user = await createUser()
    const group = await createGroupWithMember(user)
    const post = await createPost({ groupId: group.id, authorId: user.id })
    await comment({ postId: post.id, authorId: user.id, minute: 1 })
    await comment({ postId: post.id, authorId: user.id, minute: 2 })
    const newest = await comment({ postId: post.id, authorId: user.id, minute: 3 })

    const first = await get(post.id, user, '?take=1')
    await prisma.comment.delete({ where: { id: newest.id } })

    const second = await get(post.id, user, `?take=1&cursor=${first.nextCursor}`)
    expect(second.items.map((c: { content: string }) => c.content)).toEqual(['c2'])
  })

  it('applies the assetUrl filter alongside the cursor', async () => {
    const user = await createUser()
    const group = await createGroupWithMember(user)
    const asset = `/uploads/${randomUUID()}.jpg`
    const post = await createPost({ groupId: group.id, authorId: user.id, uploadedAssetUrls: [asset] })
    await comment({ postId: post.id, authorId: user.id, minute: 1, assetUrl: asset })
    await comment({ postId: post.id, authorId: user.id, minute: 2 })
    await comment({ postId: post.id, authorId: user.id, minute: 3, assetUrl: asset })

    const page = await get(post.id, user, `?take=10&assetUrl=${encodeURIComponent(asset)}`)
    expect(page.items.map((c: { content: string }) => c.content)).toEqual(['c3', 'c1'])
    expect(page.nextCursor).toBeNull()
  })

  it('dedupes cross-post handler copies and re-parents replies onto the kept copy', async () => {
    const user = await createUser()
    const groupA = await createGroupWithMember(user)
    const groupB = await createGroupWithMember(user)
    const crossPostId = randomUUID()
    const postA = await prisma.post.create({
      data: { groupId: groupA.id, authorId: user.id, content: 'x', crossPostId },
    })
    const postB = await prisma.post.create({
      data: { groupId: groupB.id, authorId: user.id, content: 'x', crossPostId, createdAt: postA.createdAt },
    })
    const metadata = { kind: 'trip_checkin', checkinId: randomUUID(), place: 'Ghent', photoUrls: [] }
    const copyA = await comment({ postId: postA.id, authorId: user.id, minute: 1, metadata })
    const copyB = await comment({ postId: postB.id, authorId: user.id, minute: 1, metadata })
    await comment({ postId: postB.id, authorId: user.id, minute: 2, parentId: copyB.id })
    await comment({ postId: postB.id, authorId: user.id, minute: 3 })

    const page = await get(postA.id, user, '?take=30')
    expect(page.items.map((c: { content: string }) => c.content)).toEqual(['c3', 'c2', 'c1'])
    expect(page.items.every((c: { postId: string }) => c.postId === postA.id)).toBe(true)
    expect(page.items.find((c: { content: string }) => c.content === 'c2').parentId).toBe(copyA.id)
  })

  it('still 403s a non-member asking for a page', async () => {
    const author = await createUser()
    const outsider = await createUser()
    const group = await createGroupWithMember(author)
    const post = await createPost({ groupId: group.id, authorId: author.id })

    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/${post.id}/comments?take=10`,
      headers: authHeader(outsider),
    })
    expect(res.statusCode).toBe(403)
  })
})
