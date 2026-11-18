import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { prisma } from '../db.js'
import { createUserToken } from '../plugins/auth.js'

// GET /api/admin/stats — the dashboard overview. Pins two behaviors:
// recent activity excludes circles the calling admin isn't a member of
// (like every other admin content surface), while totals and the 14-day
// trend stay global aggregates; and the trend buckets posts by UTC day.

const runId = `${Date.now()}`
const groupId = `test-group-stats-${runId}`
const circleId = `test-circle-stats-${runId}`

let app: FastifyInstance
let admin: { id: string; email: string; name: string; tokenVersion: number }
let author: { id: string; email: string; name: string; tokenVersion: number }
let adminToken: string
let authorToken: string

// Fixed UTC timestamps so the day-bucket assertions don't depend on when
// the suite runs (files run serially against a truncated database).
const now = new Date()
const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
const familyPostId = `test-post-family-${runId}`
const circlePostId = `test-post-circle-${runId}`
const oldPostId = `test-post-old-${runId}`
const outOfRangePostId = `test-post-out-${runId}`

beforeAll(async () => {
  app = await buildApp()

  await prisma.group.create({ data: { id: groupId, name: 'Test Group Stats' } })
  admin = await prisma.user.create({
    data: { email: `admin-stats-${runId}@test.local`, name: 'Admin Stats', isAdmin: true },
  })
  author = await prisma.user.create({
    data: { email: `author-stats-${runId}@test.local`, name: 'Author Stats' },
  })
  await prisma.groupMember.createMany({
    data: [
      { groupId, userId: admin.id },
      { groupId, userId: author.id },
    ],
  })
  await prisma.circle.create({ data: { id: circleId, groupId, name: 'Private Circle', createdById: author.id } })
  await prisma.circleMember.create({ data: { circleId, userId: author.id } })

  await prisma.post.create({
    data: {
      id: familyPostId,
      groupId,
      authorId: author.id,
      content: 'Family post',
      createdAt: new Date(todayUtc + 9 * 3600_000),
    },
  })
  await prisma.post.create({
    data: {
      id: circlePostId,
      groupId,
      circleId,
      authorId: author.id,
      content: 'Circle post',
      createdAt: new Date(todayUtc + 10 * 3600_000),
    },
  })
  await prisma.post.create({
    data: {
      id: oldPostId,
      groupId,
      authorId: author.id,
      content: 'Old post',
      createdAt: new Date(todayUtc - 3 * 86_400_000 + 23.5 * 3600_000),
    },
  })
  await prisma.post.create({
    data: {
      id: outOfRangePostId,
      groupId,
      authorId: author.id,
      content: 'Ancient post',
      createdAt: new Date(todayUtc - 20 * 86_400_000),
    },
  })

  adminToken = createUserToken({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    isAdmin: true,
    tokenVersion: admin.tokenVersion,
  })
  authorToken = createUserToken({
    id: author.id,
    email: author.email,
    name: author.name,
    isAdmin: false,
    tokenVersion: author.tokenVersion,
  })
})

afterAll(async () => {
  await prisma.group.delete({ where: { id: groupId } })
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, author.id] } } })
  await app.close()
  await prisma.$disconnect()
})

const getStats = (token: string) =>
  app.inject({ method: 'GET', url: '/api/admin/stats', headers: { authorization: `Bearer ${token}` } })

describe('GET /api/admin/stats', () => {
  it('rejects non-admins', async () => {
    const res = await getStats(authorToken)
    expect(res.statusCode).toBe(403)
  })

  it('excludes circle posts from recent activity for an admin outside the circle', async () => {
    const res = await getStats(adminToken)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const ids = body.recentPosts.map((p: { id: string }) => p.id)
    expect(ids).toContain(familyPostId)
    expect(ids).toContain(oldPostId)
    expect(ids).not.toContain(circlePostId)
  })

  it('keeps totals and the trend global, bucketed by UTC day', async () => {
    const res = await getStats(adminToken)
    expect(res.statusCode).toBe(200)
    const body = res.json()

    // Aggregates include the circle post and the out-of-range post.
    expect(body.counts.posts).toBe(4)
    expect(body.topGroups[0]).toMatchObject({ id: groupId, postCount: 4 })

    expect(body.postsByDay).toHaveLength(14)
    const byDate = new Map<string, number>(
      body.postsByDay.map((d: { date: string; count: number }) => [d.date, d.count])
    )
    const todayKey = new Date(todayUtc).toISOString().slice(0, 10)
    const oldKey = new Date(todayUtc - 3 * 86_400_000).toISOString().slice(0, 10)
    // Today: family + circle post (the trend is an aggregate, not a reading surface).
    expect(byDate.get(todayKey)).toBe(2)
    // 23:30 UTC three days ago lands in that UTC day, not the server's local one.
    expect(byDate.get(oldKey)).toBe(1)
    // The 20-day-old post is outside the window.
    expect(body.postsByDay.reduce((sum: number, d: { count: number }) => sum + d.count, 0)).toBe(3)
  })

  it('shows the circle post once the admin joins the circle, and hides it again on leave', async () => {
    await prisma.circleMember.create({ data: { circleId, userId: admin.id } })
    const joined = await getStats(adminToken)
    expect(joined.statusCode).toBe(200)
    const joinedIds = joined.json().recentPosts.map((p: { id: string }) => p.id)
    expect(joinedIds).toContain(circlePostId)
    // Newest first: the circle post was created after the family post.
    expect(joinedIds[0]).toBe(circlePostId)

    await prisma.circleMember.deleteMany({ where: { circleId, userId: admin.id } })
    const left = await getStats(adminToken)
    expect(left.statusCode).toBe(200)
    expect(left.json().recentPosts.map((p: { id: string }) => p.id)).not.toContain(circlePostId)
  })
})
