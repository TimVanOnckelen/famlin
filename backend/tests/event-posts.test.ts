import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader } from './helpers.js'

type TestUser = Awaited<ReturnType<typeof createUser>>
type EventView = {
  startsAt: string
  endsAt: string | null
  location: string | null
  rsvpDeadline: string | null
  closed: boolean
  myRsvp: 'yes' | 'maybe' | 'no' | null
  counts: { yes: number; maybe: number; no: number }
  responses: Record<'yes' | 'maybe' | 'no', Array<{ id: string; name: string; avatarUrl: string | null }>>
}

const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60_000)

// EVENT post type (services/postTypes/event.ts): the title is `content`,
// typeData carries startsAt/endsAt/location/rsvpDeadline, and RSVPs are
// PostInteraction rows (key 'rsvp') with poll-style toggle semantics. A
// cross-posted event merges RSVPs across the siblings a viewer can see.
describe('EVENT posts', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  async function createEvent(author: TestUser, target: { groupId: string } | { groupIds: string[] }, typeData = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: {
        ...target,
        content: 'Sunday lunch at grandma’s',
        type: 'EVENT',
        typeData: { startsAt: inAWeek().toISOString(), ...typeData },
      },
    })
    expect(res.statusCode).toBe(200)
    return res.json() as { id: string }
  }

  async function rsvp(user: TestUser, postId: string, value: unknown, key = 'rsvp') {
    return app.inject({
      method: 'POST',
      url: `/api/posts/${postId}/interactions`,
      headers: authHeader(user),
      payload: { key, value },
    })
  }

  async function getEvent(user: TestUser, postId: string): Promise<EventView> {
    const res = await app.inject({ method: 'GET', url: `/api/posts/${postId}`, headers: authHeader(user) })
    expect(res.statusCode).toBe(200)
    return res.json().event
  }

  describe('creating an event', () => {
    it('normalizes datetimes to UTC and returns an empty RSVP view', async () => {
      const author = await createUser()
      const group = await createGroupWithMember(author)

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: group.id,
          content: 'Sunday lunch',
          type: 'EVENT',
          typeData: {
            startsAt: '2030-06-02T13:00:00+01:00',
            endsAt: '2030-06-02T17:00:00+01:00',
            location: '  Grandma’s house  ',
            rsvpDeadline: '2030-05-31T20:00:00Z',
          },
        },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.type).toBe('EVENT')
      expect(body.typeData).toEqual({
        startsAt: '2030-06-02T12:00:00.000Z',
        endsAt: '2030-06-02T16:00:00.000Z',
        location: 'Grandma’s house',
        rsvpDeadline: '2030-05-31T20:00:00.000Z',
      })

      expect(await getEvent(author, body.id)).toEqual({
        ...body.typeData,
        closed: false,
        myRsvp: null,
        counts: { yes: 0, maybe: 0, no: 0 },
        responses: { yes: [], maybe: [], no: [] },
      })
    })

    it('stores null for the optional fields', async () => {
      const author = await createUser()
      const group = await createGroupWithMember(author)
      const event = await createEvent(author, { groupId: group.id })

      const row = await prisma.post.findUniqueOrThrow({ where: { id: event.id } })
      expect(row.typeData).toMatchObject({ endsAt: null, location: null, rsvpDeadline: null })
    })

    it.each([
      ['an empty title', '  ', {}, 'An event needs a title'],
      ['an end before the start', 'Lunch', { endsAt: new Date().toISOString() }, "The end can't be"],
      [
        'an RSVP deadline after the start',
        'Lunch',
        { rsvpDeadline: new Date(Date.now() + 8 * 24 * 60 * 60_000).toISOString() },
        "The RSVP deadline can't be",
      ],
    ])('rejects %s with a translated error', async (_label, content, extraTypeData, message) => {
      const author = await createUser()
      const group = await createGroupWithMember(author)

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: group.id,
          content,
          type: 'EVENT',
          typeData: { startsAt: inAWeek().toISOString(), ...extraTypeData },
        },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toContain(message)
    })

    it.each([
      ['no typeData', undefined],
      ['a missing startsAt', { location: 'Park' }],
      ['a malformed startsAt', { startsAt: 'next sunday' }],
    ])('rejects %s', async (_label, typeData) => {
      const author = await createUser()
      const group = await createGroupWithMember(author)

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'Lunch', type: 'EVENT', typeData },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('RSVPs', () => {
    it('answers, switches and clears, updating counts, responses and myRsvp', async () => {
      const author = await createUser()
      const guest = await createUser({ name: 'Guest' })
      const group = await createGroupWithMember(author)
      await addMember(group.id, guest.id)
      const event = await createEvent(author, { groupId: group.id })

      let res = await rsvp(guest, event.id, 'yes')
      expect(res.statusCode).toBe(200)
      expect(res.json().event.myRsvp).toBe('yes')
      expect(res.json().event.counts).toEqual({ yes: 1, maybe: 0, no: 0 })
      expect(res.json().event.responses.yes).toEqual([{ id: guest.id, name: 'Guest', avatarUrl: null }])

      res = await rsvp(guest, event.id, 'maybe')
      expect(res.json().event.myRsvp).toBe('maybe')
      expect(res.json().event.counts).toEqual({ yes: 0, maybe: 1, no: 0 })

      // The same answer again clears it, like a poll vote.
      res = await rsvp(guest, event.id, 'maybe')
      expect(res.json().event.myRsvp).toBeNull()
      expect(res.json().event.counts).toEqual({ yes: 0, maybe: 0, no: 0 })

      expect(await prisma.postInteraction.count({ where: { postId: event.id } })).toBe(0)
    })

    it('shows every member the same public guest list', async () => {
      const author = await createUser()
      const guest = await createUser()
      const group = await createGroupWithMember(author)
      await addMember(group.id, guest.id)
      const event = await createEvent(author, { groupId: group.id })

      await rsvp(guest, event.id, 'no')
      const authorView = await getEvent(author, event.id)
      expect(authorView.myRsvp).toBeNull()
      expect(authorView.responses.no.map((u) => u.id)).toEqual([guest.id])
    })

    it.each([
      ['an unknown answer', 'rsvp', 'perhaps'],
      ['a non-string answer', 'rsvp', { response: 'yes' }],
      ['a different interaction key', 'vote', 'yes'],
    ])('rejects %s', async (_label, key, value) => {
      const author = await createUser()
      const group = await createGroupWithMember(author)
      const event = await createEvent(author, { groupId: group.id })

      const res = await rsvp(author, event.id, value, key)
      expect(res.statusCode).toBe(400)
    })

    it('refuses RSVPs from someone outside the family', async () => {
      const author = await createUser()
      const outsider = await createUser()
      const group = await createGroupWithMember(author)
      const event = await createEvent(author, { groupId: group.id })

      const res = await rsvp(outsider, event.id, 'yes')
      expect(res.statusCode).toBeGreaterThanOrEqual(403)
      expect(await prisma.postInteraction.count({ where: { postId: event.id } })).toBe(0)
    })

    it('closes RSVPs after the deadline', async () => {
      const author = await createUser()
      const group = await createGroupWithMember(author)
      const event = await createEvent(author, { groupId: group.id })

      const row = await prisma.post.findUniqueOrThrow({ where: { id: event.id } })
      await prisma.post.update({
        where: { id: event.id },
        data: {
          typeData: { ...(row.typeData as object), rsvpDeadline: new Date(Date.now() - 60_000).toISOString() },
        },
      })

      const res = await rsvp(author, event.id, 'yes')
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('RSVPs for this event are closed')
      expect((await getEvent(author, event.id)).closed).toBe(true)
    })

    it('closes RSVPs once the event starts when there is no deadline', async () => {
      const author = await createUser()
      const group = await createGroupWithMember(author)
      const event = await createEvent(
        author,
        { groupId: group.id },
        { startsAt: new Date(Date.now() - 60_000).toISOString() }
      )

      const res = await rsvp(author, event.id, 'yes')
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toBe('RSVPs for this event are closed')
      expect((await getEvent(author, event.id)).closed).toBe(true)
    })
  })

  describe('cross-posted events', () => {
    it('merges RSVPs across the siblings a viewer can see, and only those', async () => {
      const author = await createUser()
      const memberA = await createUser()
      const memberB = await createUser()
      const groupA = await createGroupWithMember(author)
      const groupB = await createGroupWithMember(author)
      await addMember(groupA.id, memberA.id)
      await addMember(groupB.id, memberB.id)

      await createEvent(author, { groupIds: [groupA.id, groupB.id] })
      const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, type: 'EVENT' } })
      const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, type: 'EVENT' } })

      expect((await rsvp(memberA, postA.id, 'yes')).statusCode).toBe(200)
      expect((await rsvp(memberB, postB.id, 'maybe')).statusCode).toBe(200)

      // The author belongs to both families and sees the whole guest list
      // from either copy.
      for (const postId of [postA.id, postB.id]) {
        const view = await getEvent(author, postId)
        expect(view.counts).toEqual({ yes: 1, maybe: 1, no: 0 })
        expect(view.responses.yes.map((u) => u.id)).toEqual([memberA.id])
        expect(view.responses.maybe.map((u) => u.id)).toEqual([memberB.id])
      }

      // A member of one family learns nothing about the other family.
      const viewA = await getEvent(memberA, postA.id)
      expect(viewA.counts).toEqual({ yes: 1, maybe: 0, no: 0 })
      expect(JSON.stringify(viewA)).not.toContain(memberB.id)
    })

    it('keeps one answer per person when they belong to several target families', async () => {
      const author = await createUser()
      const both = await createUser()
      const groupA = await createGroupWithMember(author)
      const groupB = await createGroupWithMember(author)
      await addMember(groupA.id, both.id)
      await addMember(groupB.id, both.id)

      await createEvent(author, { groupIds: [groupA.id, groupB.id] })
      const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, type: 'EVENT' } })
      const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, type: 'EVENT' } })

      await rsvp(both, postA.id, 'yes')
      const res = await rsvp(both, postB.id, 'no')
      expect(res.json().event.myRsvp).toBe('no')
      expect(res.json().event.counts).toEqual({ yes: 0, maybe: 0, no: 1 })

      const rows = await prisma.postInteraction.findMany({ where: { userId: both.id, key: 'rsvp' } })
      expect(rows).toHaveLength(1)
      expect(rows[0].postId).toBe(postB.id)
      expect((await getEvent(author, postA.id)).myRsvp).toBeNull()
      expect((await getEvent(both, postA.id)).myRsvp).toBe('no')
    })

    it('clears an answer from a different copy than the one that holds it', async () => {
      const author = await createUser()
      const both = await createUser()
      const groupA = await createGroupWithMember(author)
      const groupB = await createGroupWithMember(author)
      await addMember(groupA.id, both.id)
      await addMember(groupB.id, both.id)

      await createEvent(author, { groupIds: [groupA.id, groupB.id] })
      const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, type: 'EVENT' } })
      const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, type: 'EVENT' } })

      await rsvp(both, postA.id, 'yes')
      expect((await getEvent(both, postB.id)).myRsvp).toBe('yes')

      const res = await rsvp(both, postB.id, 'yes')
      expect(res.statusCode).toBe(200)
      expect(res.json().event.myRsvp).toBeNull()
      expect(await prisma.postInteraction.count({ where: { userId: both.id, key: 'rsvp' } })).toBe(0)
    })

    it("leaves an answer on a copy in a family they've since left alone", async () => {
      const author = await createUser()
      const leaver = await createUser()
      const groupA = await createGroupWithMember(author)
      const groupB = await createGroupWithMember(author)
      await addMember(groupA.id, leaver.id)
      await addMember(groupB.id, leaver.id)

      await createEvent(author, { groupIds: [groupA.id, groupB.id] })
      const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, type: 'EVENT' } })
      const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, type: 'EVENT' } })

      await rsvp(leaver, postA.id, 'yes')
      await prisma.groupMember.deleteMany({ where: { groupId: groupA.id, userId: leaver.id } })
      await rsvp(leaver, postB.id, 'no')

      const rows = await prisma.postInteraction.findMany({ where: { userId: leaver.id, key: 'rsvp' } })
      expect(rows.map((row) => row.postId).sort()).toEqual([postA.id, postB.id].sort())
    })
  })

  describe('simultaneous answers', () => {
    it('settles on one answer without a server error', async () => {
      const author = await createUser()
      const guest = await createUser()
      const group = await createGroupWithMember(author)
      await addMember(group.id, guest.id)
      const event = await createEvent(author, { groupId: group.id })

      const results = await Promise.all([rsvp(guest, event.id, 'yes'), rsvp(guest, event.id, 'no')])
      expect(results.map((res) => res.statusCode)).toEqual([200, 200])
      expect(await prisma.postInteraction.count({ where: { userId: guest.id, postId: event.id } })).toBe(1)
    })
  })
})
