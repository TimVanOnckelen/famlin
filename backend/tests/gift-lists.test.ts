import { randomUUID } from 'crypto'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, createUser, authHeader, createGroup, addMember } from './helpers.js'
import { prisma } from '../src/db.js'
import { computeDraw } from '../src/services/giftLists.js'

// Gift lists (issue #307). The properties that matter most:
//  - a family member who isn't a participant gets NOTHING, on every surface
//    (the hidden-circle audience must fail closed like a Family Circle);
//  - after the draw, each participant learns only their own recipient —
//    nobody, the starter included, can see the full pairing set.

type User = Awaited<ReturnType<typeof createUser>>

let app: FastifyInstance
let starter: User
let alice: User
let bob: User
let carol: User
let outsider: User
let admin: User
let group: Awaited<ReturnType<typeof createGroup>>
let otherGroup: Awaited<ReturnType<typeof createGroup>>

async function createGiftList(by: User, typeData: Record<string, unknown>, groupId = group.id) {
  return app.inject({
    method: 'POST',
    url: '/api/posts',
    headers: authHeader(by),
    payload: { groupId, type: 'GIFT_LIST', typeData },
  })
}

async function addItem(by: User, postId: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/gift-lists/${postId}/items`, headers: authHeader(by), payload })
}

async function getPost(by: User, postId: string) {
  return app.inject({ method: 'GET', url: `/api/posts/${postId}`, headers: authHeader(by) })
}

beforeAll(async () => {
  app = await buildTestApp()
  starter = await createUser({ name: 'Starter' })
  alice = await createUser({ name: 'Alice' })
  bob = await createUser({ name: 'Bob' })
  carol = await createUser({ name: 'Carol' })
  outsider = await createUser({ name: 'Outsider' })
  admin = await createUser({ name: 'Admin', isAdmin: true })
  group = await createGroup({ name: 'Gift family' })
  otherGroup = await createGroup({ name: 'Other family' })
  for (const u of [starter, alice, bob, carol, outsider, admin]) await addMember(group.id, u.id)
  await addMember(otherGroup.id, starter.id)
})

afterAll(async () => {
  await prisma.group.deleteMany({ where: { id: { in: [group.id, otherGroup.id] } } })
  await prisma.user.deleteMany({
    where: { id: { in: [starter, alice, bob, carol, outsider, admin].map((u) => u.id) } },
  })
  await app.close()
})

describe('computeDraw', () => {
  it('gives everyone exactly one other person, honoring exclusions', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    for (let i = 0; i < 50; i++) {
      const draw = computeDraw(ids, [['a', 'b']])!
      expect([...draw.keys()].sort()).toEqual(ids)
      expect([...draw.values()].sort()).toEqual(ids)
      for (const [giver, recipient] of draw) expect(giver).not.toBe(recipient)
      expect(draw.get('a')).not.toBe('b')
      expect(draw.get('b')).not.toBe('a')
    }
  })

  it('falls back to a matching that still honors exclusions', () => {
    const ids = ['a', 'b', 'c', 'd']
    const exclusions: Array<[string, string]> = [
      ['a', 'b'],
      ['c', 'd'],
    ]
    const draw = computeDraw(ids, exclusions, 0)!
    expect([...draw.values()].sort()).toEqual(ids)
    for (const [giver, recipient] of draw) {
      expect(giver).not.toBe(recipient)
      expect(exclusions.some(([x, y]) => (x === giver && y === recipient) || (y === giver && x === recipient))).toBe(
        false
      )
    }
  })

  it('returns null when no valid draw exists', () => {
    // c is excluded with both others, so nobody can give to c.
    expect(
      computeDraw(
        ['a', 'b', 'c'],
        [
          ['a', 'c'],
          ['b', 'c'],
        ]
      )
    ).toBeNull()
  })
})

describe('creating a gift list', () => {
  it('rejects participants outside the family', async () => {
    const stranger = await createUser({ name: 'Stranger' })
    const res = await createGiftList(starter, { title: 'Xmas', participantUserIds: [stranger.id] })
    expect(res.statusCode).toBe(400)
    await prisma.user.delete({ where: { id: stranger.id } })
  })

  it('rejects cross-posting and a client-chosen circle', async () => {
    const cross = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(starter),
      payload: { groupIds: [group.id, otherGroup.id], type: 'GIFT_LIST', typeData: { title: 'Xmas' } },
    })
    expect(cross.statusCode).toBe(400)

    const circle = await prisma.circle.create({
      data: { groupId: group.id, name: 'Kids', members: { create: [{ userId: starter.id }] } },
    })
    const withCircle = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(starter),
      payload: { groupId: group.id, circleId: circle.id, type: 'GIFT_LIST', typeData: { title: 'Xmas' } },
    })
    expect(withCircle.statusCode).toBe(400)
    await prisma.circle.delete({ where: { id: circle.id } })
  })

  it('creates the post with a hidden circle of participants and invites them', async () => {
    const res = await createGiftList(starter, {
      title: 'Christmas 2026',
      occasionDate: '2026-12-25',
      participantUserIds: [alice.id, bob.id],
      drawEnabled: true,
      budget: '€25',
    })
    expect(res.statusCode).toBe(200)
    const post = res.json()
    expect(post.circle).toBeNull()
    expect(post.typeData).toMatchObject({ title: 'Christmas 2026', drawEnabled: true, budget: '€25', drawnAt: null })
    expect(post.typeData.participantUserIds).toBeUndefined()

    const circle = await prisma.circle.findUnique({ where: { id: post.circleId }, include: { members: true } })
    expect(circle?.kind).toBe('GIFT_LIST')
    expect(circle?.members.map((m) => m.userId).sort()).toEqual([starter.id, alice.id, bob.id].sort())

    await vi.waitFor(async () => {
      const invites = await prisma.notification.findMany({
        where: { relatedPostId: post.id, type: 'gift_list_invite' },
      })
      expect(invites.map((n) => n.userId).sort()).toEqual([alice.id, bob.id].sort())
    })
    // Not the generic new_post — and never to non-participants.
    expect(await prisma.notification.count({ where: { relatedPostId: post.id, type: 'new_post' } })).toBe(0)
  })
})

describe('visibility for non-participants', () => {
  let postId: string

  beforeAll(async () => {
    const res = await createGiftList(starter, { title: 'Secret list', participantUserIds: [alice.id] })
    postId = res.json().id
    await addItem(alice, postId, { title: 'Scarf' })
  })

  it('binds an item photo to the participants only', async () => {
    const uuid = randomUUID()
    await prisma.upload.create({ data: { assetKey: uuid, uploaderId: alice.id, bound: false } })
    const res = await addItem(alice, postId, { title: 'Hat', photoUrl: `/uploads/${uuid}.jpg` })
    expect(res.statusCode).toBe(200)
    const post = await prisma.post.findUnique({ where: { id: postId } })
    const row = await prisma.upload.findUnique({ where: { assetKey: uuid } })
    expect(row).toMatchObject({ bound: true, circleId: post!.circleId, groupIds: [group.id] })
    await prisma.upload.delete({ where: { assetKey: uuid } })
  })

  it('hides the post from the feed, detail, search and the overview', async () => {
    const feed = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(outsider) })
    expect(feed.json().items.map((p: { id: string }) => p.id)).not.toContain(postId)

    expect((await getPost(outsider, postId)).statusCode).toBe(404)
    expect((await getPost(admin, postId)).statusCode).toBe(404)

    const search = await app.inject({
      method: 'GET',
      url: `/api/posts/search?groupId=${group.id}&q=Secret`,
      headers: authHeader(outsider),
    })
    expect(search.json().items).toHaveLength(0)

    const overview = await app.inject({ method: 'GET', url: '/api/gift-lists', headers: authHeader(outsider) })
    expect(overview.json().items.map((p: { id: string }) => p.id)).not.toContain(postId)

    const mine = await app.inject({ method: 'GET', url: '/api/gift-lists', headers: authHeader(alice) })
    expect(mine.json().items.map((p: { id: string }) => p.id)).toContain(postId)
  })

  it('404s every gift list route for a non-participant', async () => {
    const h = authHeader(outsider)
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: `/api/gift-lists/${postId}/items`, headers: h }),
      app.inject({ method: 'POST', url: `/api/gift-lists/${postId}/items`, headers: h, payload: { title: 'x' } }),
      app.inject({ method: 'POST', url: `/api/gift-lists/${postId}/draw`, headers: h }),
      app.inject({ method: 'DELETE', url: `/api/gift-lists/${postId}/participants/me`, headers: h }),
      app.inject({ method: 'PATCH', url: `/api/gift-lists/${postId}`, headers: h, payload: { title: 'x' } }),
    ])
    for (const res of responses) expect(res.statusCode).toBe(404)
  })

  it('never surfaces the hidden circle as a Family Circle', async () => {
    const circles = await app.inject({
      method: 'GET',
      url: `/api/circles?groupId=${group.id}`,
      headers: authHeader(alice),
    })
    expect(circles.json().items).toHaveLength(0)

    const adminCircles = await app.inject({
      method: 'GET',
      url: `/api/admin/groups/${group.id}/circles`,
      headers: authHeader(admin),
    })
    expect(adminCircles.json()).toHaveLength(0)

    const post = await prisma.post.findUnique({ where: { id: postId } })
    const adminDelete = await app.inject({
      method: 'DELETE',
      url: `/api/admin/circles/${post!.circleId}?deleteContent=true`,
      headers: authHeader(admin),
    })
    expect(adminDelete.statusCode).toBe(404)

    // Nor can an ordinary post be aimed at it.
    const sneaky = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(alice),
      payload: { groupId: group.id, content: 'hi', circleId: post!.circleId },
    })
    expect(sneaky.statusCode).toBe(403)
  })

  it('excludes it from admin content moderation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/content/posts?groupId=${group.id}`,
      headers: authHeader(admin),
    })
    expect(res.json().items.map((p: { id: string }) => p.id)).not.toContain(postId)
  })
})

describe('wishlists', () => {
  let postId: string

  beforeAll(async () => {
    postId = (await createGiftList(starter, { title: 'Birthday', participantUserIds: [alice.id, bob.id] })).json().id
  })

  it('lets each participant manage only their own items, visible to all', async () => {
    const created = await addItem(alice, postId, {
      title: 'Book',
      note: 'Hardcover',
      url: 'https://shop.example/book',
    })
    expect(created.statusCode).toBe(200)
    const item = created.json()
    expect(item).toMatchObject({ ownerId: alice.id, title: 'Book', position: 0 })

    const second = (await addItem(alice, postId, { title: 'Socks' })).json()
    expect(second.position).toBe(1)

    // Bob sees Alice's list but can't change it.
    const list = await app.inject({ method: 'GET', url: `/api/gift-lists/${postId}/items`, headers: authHeader(bob) })
    expect(list.json().items.map((i: { title: string }) => i.title)).toEqual(['Book', 'Socks'])
    const bobEdit = await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}/items/${item.id}`,
      headers: authHeader(bob),
      payload: { title: 'Hacked' },
    })
    expect(bobEdit.statusCode).toBe(404)

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}/items/${item.id}`,
      headers: authHeader(alice),
      payload: { note: null },
    })
    expect(edit.json()).toMatchObject({ title: 'Book', note: null })

    const reorder = await app.inject({
      method: 'PUT',
      url: `/api/gift-lists/${postId}/items/order`,
      headers: authHeader(alice),
      payload: { itemIds: [second.id, item.id] },
    })
    expect(reorder.json().items.map((i: { title: string }) => i.title)).toEqual(['Socks', 'Book'])

    const badOrder = await app.inject({
      method: 'PUT',
      url: `/api/gift-lists/${postId}/items/order`,
      headers: authHeader(alice),
      payload: { itemIds: [item.id] },
    })
    expect(badOrder.statusCode).toBe(400)

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/gift-lists/${postId}/items/${item.id}`,
      headers: authHeader(alice),
    })
    expect(del.statusCode).toBe(200)
  })

  it('gives concurrent adds distinct positions', async () => {
    const results = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((title) => addItem(bob, postId, { title })))
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    const positions = results.map((r) => r.json().position).sort()
    expect(new Set(positions).size).toBe(5)
  })

  it("deletes a wish photo's files with the wish, but never a photo shared elsewhere", async () => {
    const post = await prisma.post.findUnique({ where: { id: postId } })
    const wishOnly = randomUUID()
    const shared = randomUUID()
    await prisma.upload.createMany({
      data: [
        { assetKey: wishOnly, uploaderId: alice.id, bound: false },
        // Already in a family post: group-scoped, so not the wish's to delete.
        { assetKey: shared, uploaderId: alice.id, bound: true, groupIds: [group.id] },
      ],
    })
    const a = (await addItem(alice, postId, { title: 'Lamp', photoUrl: `/uploads/${wishOnly}.jpg` })).json()
    const b = (await addItem(alice, postId, { title: 'Vase', photoUrl: `/uploads/${shared}.jpg` })).json()
    expect((await prisma.upload.findUnique({ where: { assetKey: wishOnly } }))?.circleId).toBe(post!.circleId)

    for (const item of [a, b]) {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/gift-lists/${postId}/items/${item.id}`,
        headers: authHeader(alice),
      })
      expect(res.statusCode).toBe(200)
    }
    expect(await prisma.upload.findUnique({ where: { assetKey: wishOnly } })).toBeNull()
    expect(await prisma.upload.findUnique({ where: { assetKey: shared } })).not.toBeNull()
    await prisma.upload.delete({ where: { assetKey: shared } })
  })

  it('only accepts http(s) shop links', async () => {
    const res = await addItem(alice, postId, { title: 'Bad', url: 'javascript:alert(1)' })
    expect(res.statusCode).toBe(400)
  })

  it('reports per-participant item counts on the post', async () => {
    const post = (await getPost(bob, postId)).json()
    expect(post.giftList.participants.find((p: { id: string }) => p.id === alice.id).itemCount).toBe(1)
    expect(post.giftList.isManager).toBe(false)
    expect(post.giftList.exclusions).toBeNull()
  })
})

describe('Secret Santa draw', () => {
  let postId: string

  beforeAll(async () => {
    postId = (
      await createGiftList(starter, {
        title: 'Sinterklaas',
        participantUserIds: [alice.id, bob.id, carol.id],
        drawEnabled: true,
        exclusions: [[alice.id, bob.id]],
      })
    ).json().id
  })

  it('only lets the starter draw, and refuses impossible exclusions', async () => {
    const notStarter = await app.inject({
      method: 'POST',
      url: `/api/gift-lists/${postId}/draw`,
      headers: authHeader(alice),
    })
    expect(notStarter.statusCode).toBe(403)

    const impossible = await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}`,
      headers: authHeader(starter),
      payload: {
        exclusions: [
          [carol.id, starter.id],
          [carol.id, alice.id],
          [carol.id, bob.id],
        ],
      },
    })
    // Not drawn yet: storing them is fine, drawing is what fails.
    expect(impossible.statusCode).toBe(200)
    const draw = await app.inject({
      method: 'POST',
      url: `/api/gift-lists/${postId}/draw`,
      headers: authHeader(starter),
    })
    expect(draw.statusCode).toBe(400)

    await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}`,
      headers: authHeader(starter),
      payload: { exclusions: [[alice.id, bob.id]] },
    })
  })

  it('shows each participant only their own recipient', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/gift-lists/${postId}/draw`,
      headers: authHeader(starter),
    })
    expect(res.statusCode).toBe(200)

    const participants = [starter, alice, bob, carol]
    const recipients = new Map<string, string>()
    for (const p of participants) {
      const post = (await getPost(p, postId)).json()
      expect(post.giftList.drawn).toBe(true)
      const recipient = post.giftList.myRecipient
      expect(recipient.id).not.toBe(p.id)
      recipients.set(p.id, recipient.id)
      // No response carries anything resembling the pairing set.
      expect(JSON.stringify(post)).not.toMatch(/giverId|assignments/)
    }
    expect(new Set(recipients.values()).size).toBe(4)
    expect(recipients.get(alice.id)).not.toBe(bob.id)
    expect(recipients.get(bob.id)).not.toBe(alice.id)

    await vi.waitFor(async () => {
      const notes = await prisma.notification.findMany({ where: { relatedPostId: postId, type: 'gift_draw' } })
      expect(notes).toHaveLength(4) // everyone, the starter included
      for (const n of notes) {
        for (const p of participants) expect(n.message).not.toContain(p.name)
      }
    })

    const again = await app.inject({
      method: 'POST',
      url: `/api/gift-lists/${postId}/draw`,
      headers: authHeader(starter),
    })
    expect(again.statusCode).toBe(409)
  })

  it("puts wishes and only the caller's own assignment in the member export", async () => {
    await addItem(bob, postId, { title: 'Bob wish' })
    const res = await app.inject({ method: 'GET', url: '/api/auth/me/export', headers: authHeader(alice) })
    expect(res.statusCode).toBe(200)
    const body = res.rawPayload.toString('utf8')
    expect(body).toContain('Bob wish')
    const assignments = await prisma.giftDrawAssignment.findMany({ where: { postId } })
    for (const a of assignments) {
      if (a.giverId === alice.id) expect(body).toContain(a.id)
      else expect(body).not.toContain(a.id)
    }
  })

  it('notifies only the giver when the recipient adds a wish, bundled per day', async () => {
    const assignment = await prisma.giftDrawAssignment.findUnique({
      where: { postId_recipientId: { postId, recipientId: carol.id } },
    })
    await addItem(carol, postId, { title: 'Puzzle' })
    await vi.waitFor(async () => {
      const notes = await prisma.notification.findMany({
        where: { relatedPostId: postId, type: 'gift_list_updated', message: { contains: 'Carol' } },
      })
      expect(notes.map((n) => n.userId)).toEqual([assignment!.giverId])
    })
    await addItem(carol, postId, { title: 'Book' })
    await vi.waitFor(async () => {
      const notes = await prisma.notification.findMany({
        where: { relatedPostId: postId, type: 'gift_list_updated', message: { contains: 'Carol' } },
      })
      expect(notes).toHaveLength(1)
      expect(notes[0].message).toContain('2')
    })
  })

  it('requires confirmation to change participants after the draw, then redraws', async () => {
    const dave = await createUser({ name: 'Dave' })
    await addMember(group.id, dave.id)

    const unconfirmed = await app.inject({
      method: 'PUT',
      url: `/api/gift-lists/${postId}/participants`,
      headers: authHeader(starter),
      payload: { userIds: [alice.id, bob.id, carol.id, dave.id] },
    })
    expect(unconfirmed.statusCode).toBe(409)

    await prisma.notification.deleteMany({ where: { relatedPostId: postId, type: 'gift_draw' } })
    const confirmed = await app.inject({
      method: 'PUT',
      url: `/api/gift-lists/${postId}/participants`,
      headers: authHeader(starter),
      payload: { userIds: [alice.id, bob.id, carol.id, dave.id], confirmRedraw: true },
    })
    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().giftList.participants).toHaveLength(5)
    expect(await prisma.giftDrawAssignment.count({ where: { postId } })).toBe(5)

    await vi.waitFor(async () => {
      expect(await prisma.notification.count({ where: { relatedPostId: postId, type: 'gift_draw' } })).toBe(5)
      expect(
        await prisma.notification.count({ where: { relatedPostId: postId, type: 'gift_list_invite', userId: dave.id } })
      ).toBe(1)
    })

    // Dave leaves on his own: redrawn among the remaining four.
    const leave = await app.inject({
      method: 'DELETE',
      url: `/api/gift-lists/${postId}/participants/me`,
      headers: authHeader(dave),
    })
    expect(leave.statusCode).toBe(200)
    expect(await prisma.giftDrawAssignment.count({ where: { postId } })).toBe(4)
    expect(await prisma.giftDrawAssignment.count({ where: { postId, recipientId: dave.id } })).toBe(0)
    await prisma.user.delete({ where: { id: dave.id } })
  })

  it('does not let the starter leave', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/gift-lists/${postId}/participants/me`,
      headers: authHeader(starter),
    })
    expect(res.statusCode).toBe(400)
  })

  it('redraws when a participant is removed from the family', async () => {
    const erin = await createUser({ name: 'Erin' })
    await addMember(group.id, erin.id)
    await app.inject({
      method: 'PUT',
      url: `/api/gift-lists/${postId}/participants`,
      headers: authHeader(starter),
      payload: { userIds: [alice.id, bob.id, carol.id, erin.id], confirmRedraw: true },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/groups/${group.id}/members/${erin.id}`,
      headers: authHeader(admin),
    })
    expect(res.statusCode).toBe(200)
    const rows = await prisma.giftDrawAssignment.findMany({ where: { postId } })
    expect(rows).toHaveLength(4)
    expect(rows.some((r) => r.giverId === erin.id || r.recipientId === erin.id)).toBe(false)
    await prisma.user.delete({ where: { id: erin.id } })
  })

  it('asks before settings changes that discard the draw, keeps it for harmless ones', async () => {
    const before = await prisma.giftDrawAssignment.findMany({ where: { postId }, orderBy: { giverId: 'asc' } })
    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}`,
      headers: authHeader(starter),
      payload: { title: 'Sinterklaas 2026', budget: '€20' },
    })
    expect(rename.statusCode).toBe(200)
    expect(rename.json().giftList).toMatchObject({ title: 'Sinterklaas 2026', budget: '€20', drawn: true })
    expect(await prisma.giftDrawAssignment.findMany({ where: { postId }, orderBy: { giverId: 'asc' } })).toEqual(before)

    const exclusions = { exclusions: [[carol.id, starter.id]] }
    const unconfirmed = await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}`,
      headers: authHeader(starter),
      payload: exclusions,
    })
    expect(unconfirmed.statusCode).toBe(409)
    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}`,
      headers: authHeader(starter),
      payload: { ...exclusions, confirmRedraw: true },
    })
    expect(confirmed.statusCode).toBe(200)
    const carolGives = await prisma.giftDrawAssignment.findUnique({
      where: { postId_giverId: { postId, giverId: carol.id } },
    })
    expect(carolGives?.recipientId).not.toBe(starter.id)
  })

  it('hides the exclusions from a participating admin in content moderation', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/gift-lists/${postId}/participants`,
      headers: authHeader(starter),
      payload: { userIds: [alice.id, bob.id, carol.id, admin.id], confirmRedraw: true },
    })
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/content/posts?groupId=${group.id}`,
      headers: authHeader(admin),
    })
    const post = res.json().items.find((p: { id: string }) => p.id === postId)
    expect(post.typeData.exclusions).toEqual([])
  })

  it('drops a departed participant from exclusions so settings stay editable', async () => {
    const fred = await createUser({ name: 'Fred' })
    await addMember(group.id, fred.id)
    await app.inject({
      method: 'PUT',
      url: `/api/gift-lists/${postId}/participants`,
      headers: authHeader(starter),
      payload: { userIds: [alice.id, bob.id, carol.id, admin.id, fred.id], confirmRedraw: true },
    })
    await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}`,
      headers: authHeader(starter),
      payload: { exclusions: [[fred.id, alice.id]], confirmRedraw: true },
    })
    // Fred deletes his account: his pair goes, the draw is redone without him.
    const del = await app.inject({ method: 'DELETE', url: '/api/auth/me', headers: authHeader(fred) })
    expect(del.statusCode).toBe(200)
    const post = await prisma.post.findUnique({ where: { id: postId } })
    expect((post!.typeData as { exclusions: unknown[] }).exclusions).toEqual([])
    expect(await prisma.giftDrawAssignment.count({ where: { postId } })).toBe(5)

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/gift-lists/${postId}`,
      headers: authHeader(starter),
      payload: { occasionDate: '2026-12-05' },
    })
    expect(edit.statusCode).toBe(200)
  })

  it("deletes a starter's list when they are removed from the family", async () => {
    const gina = await createUser({ name: 'Gina' })
    await addMember(group.id, gina.id)
    const res = await createGiftList(gina, { title: 'Gina list', participantUserIds: [alice.id] })
    const giftPost = res.json()
    const removal = await app.inject({
      method: 'DELETE',
      url: `/api/admin/groups/${group.id}/members/${gina.id}`,
      headers: authHeader(admin),
    })
    expect(removal.statusCode).toBe(200)
    expect(await prisma.post.findUnique({ where: { id: giftPost.id } })).toBeNull()
    expect(await prisma.circle.findUnique({ where: { id: giftPost.circleId } })).toBeNull()
    await prisma.user.delete({ where: { id: gina.id } })
  })

  it('removes the hidden circle when the list is deleted', async () => {
    const post = await prisma.post.findUnique({ where: { id: postId } })
    const res = await app.inject({ method: 'DELETE', url: `/api/posts/${postId}`, headers: authHeader(starter) })
    expect(res.statusCode).toBe(200)
    expect(await prisma.circle.findUnique({ where: { id: post!.circleId! } })).toBeNull()
  })
})
