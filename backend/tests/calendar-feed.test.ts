import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { updateSettings } from '../src/services/settings.js'
import { generateApiToken, hashToken } from '../src/services/apiTokens.js'
import { escapeIcalText, foldIcalLine, formatIcalDate } from '../src/services/calendarFeed.js'
import { redactLoggedUrl, requestLogSerializer } from '../src/utils/logRedaction.js'
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader } from './helpers.js'

type TestUser = Awaited<ReturnType<typeof createUser>>

const DAY = 24 * 60 * 60_000

// Unfolds content lines and splits the feed into its VEVENT blocks.
function parseEvents(ics: string): Array<Record<string, string>> {
  const unfolded = ics.replace(/\r\n /g, '')
  const events: Array<Record<string, string>> = []
  let current: Record<string, string> | null = null
  for (const line of unfolded.split('\r\n')) {
    if (line === 'BEGIN:VEVENT') current = {}
    else if (line === 'END:VEVENT') {
      events.push(current!)
      current = null
    } else if (current) {
      const idx = line.indexOf(':')
      current[line.slice(0, idx)] = line.slice(idx + 1)
    }
  }
  return events
}

describe('iCal helpers', () => {
  it('escapes TEXT values', () => {
    expect(escapeIcalText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf')
    expect(escapeIcalText('bell\u0007tab\tok')).toBe('belltab\tok')
  })

  it('folds lines at 75 octets without splitting multi-byte characters', () => {
    expect(foldIcalLine('short')).toBe('short')

    const ascii = 'X'.repeat(200)
    const folded = foldIcalLine(ascii)
    const parts = folded.split('\r\n')
    expect(parts[0]).toHaveLength(75)
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true)
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75)
    }
    expect(folded.replace(/\r\n /g, '')).toBe(ascii)

    // 3-byte characters: 75 isn't a multiple of 3 on continuation lines.
    const cjk = 'SUMMARY:' + '家'.repeat(60)
    const cjkFolded = foldIcalLine(cjk)
    for (const part of cjkFolded.split('\r\n')) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75)
      expect(part).not.toContain('�')
    }
    expect(cjkFolded.replace(/\r\n /g, '')).toBe(cjk)

    // A 4-byte emoji (a surrogate pair in JS) is never cut in half.
    const emoji = 'D:' + '🎉'.repeat(40)
    expect(emoji.length).toBeGreaterThan(75)
    expect(foldIcalLine(emoji).replace(/\r\n /g, '')).toBe(emoji)
    for (const part of foldIcalLine(emoji).split('\r\n')) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75)
      expect(Buffer.from(part, 'utf8').toString('utf8')).toBe(part)
    }
  })

  it('formats UTC date-times', () => {
    expect(formatIcalDate(new Date('2026-03-05T07:08:09.123Z'))).toBe('20260305T070809Z')
  })

  it('redacts the feed token from logged URLs', () => {
    const token = 'famlin_cal_' + 'a'.repeat(43)
    expect(redactLoggedUrl(`/api/calendar/${token}/famlin.ics`)).toBe('/api/calendar/[redacted]/famlin.ics')
    expect(redactLoggedUrl(`//api//calendar//${token}/famlin.ics?x=1`)).not.toContain(token)
    expect(redactLoggedUrl(`/api/calendar%2F${token}`)).not.toContain(token)
    expect(redactLoggedUrl('/api/auth/me/calendar-feed')).toBe('/api/auth/me/calendar-feed')
    const logged = requestLogSerializer({
      method: 'GET',
      url: `/api/calendar/${token}/famlin.ics`,
      headers: {},
      host: 'example.com',
      ip: '127.0.0.1',
    })
    expect(JSON.stringify(logged)).not.toContain(token)
  })
})

describe('calendar feed', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await updateSettings({ publicUrl: '' })
  })

  async function enableFeed(user: TestUser) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/me/calendar-feed', headers: authHeader(user) })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { url: string; webcalUrl: string; createdAt: string }
    return { ...body, path: new URL(body.url).pathname }
  }

  async function fetchFeed(path: string) {
    return app.inject({ method: 'GET', url: path })
  }

  async function feedEvents(user: TestUser) {
    const { path } = await enableFeed(user)
    const res = await fetchFeed(path)
    expect(res.statusCode).toBe(200)
    return { ics: res.body, events: parseEvents(res.body) }
  }

  async function createEvent(
    author: TestUser,
    target: { groupId: string } | { groupIds: string[] },
    title: string,
    typeData: Record<string, unknown> = {}
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: {
        ...target,
        content: title,
        type: 'EVENT',
        typeData: { startsAt: new Date(Date.now() + 7 * DAY).toISOString(), ...typeData },
      },
    })
    expect(res.statusCode).toBe(200)
    return res.json() as { id: string }
  }

  // Past events can't be created through the API (closed RSVPs are fine,
  // but this keeps the dates exact), so they're written directly.
  async function insertEvent(
    author: TestUser,
    groupId: string,
    title: string,
    startsAt: Date,
    extra: { circleId?: string } = {}
  ) {
    return prisma.post.create({
      data: {
        authorId: author.id,
        groupId,
        circleId: extra.circleId,
        content: title,
        type: 'EVENT',
        typeData: { startsAt: startsAt.toISOString(), endsAt: null, location: null, rsvpDeadline: null },
        uploadedAssetUrls: [],
      },
    })
  }

  describe('management', () => {
    it('reports status, creates, regenerates and revokes the feed', async () => {
      const user = await createUser()

      let res = await app.inject({ method: 'GET', url: '/api/auth/me/calendar-feed', headers: authHeader(user) })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ enabled: false, createdAt: null, lastUsedAt: null })

      const first = await enableFeed(user)
      expect(first.url).toMatch(/^http:\/\/localhost(:\d+)?\/api\/calendar\/famlin_cal_[A-Za-z0-9_-]{43}\/famlin\.ics$/)
      expect(first.webcalUrl).toBe(first.url.replace(/^http:\/\//, 'webcal://'))
      expect((await fetchFeed(first.path)).statusCode).toBe(200)

      res = await app.inject({ method: 'GET', url: '/api/auth/me/calendar-feed', headers: authHeader(user) })
      expect(res.json().enabled).toBe(true)
      expect(res.json().createdAt).toBeTruthy()

      // Only the hash is stored.
      const token = first.path.split('/')[3]
      const row = await prisma.calendarFeedToken.findUniqueOrThrow({ where: { userId: user.id } })
      expect(row.tokenHash).toBe(hashToken(token))
      expect(JSON.stringify(row)).not.toContain(token)

      const second = await enableFeed(user)
      expect(second.url).not.toBe(first.url)
      expect((await fetchFeed(first.path)).statusCode).toBe(404)
      expect((await fetchFeed(second.path)).statusCode).toBe(200)
      expect(await prisma.calendarFeedToken.count({ where: { userId: user.id } })).toBe(1)

      res = await app.inject({ method: 'DELETE', url: '/api/auth/me/calendar-feed', headers: authHeader(user) })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ success: true })
      expect((await fetchFeed(second.path)).statusCode).toBe(404)

      // Idempotent.
      res = await app.inject({ method: 'DELETE', url: '/api/auth/me/calendar-feed', headers: authHeader(user) })
      expect(res.statusCode).toBe(200)
    })

    it('uses the publicUrl setting for the URL when set', async () => {
      await updateSettings({ publicUrl: 'https://family.example.com/' })
      const user = await createUser()
      const { url, webcalUrl } = await enableFeed(user)
      expect(url).toMatch(/^https:\/\/family\.example\.com\/api\/calendar\/famlin_cal_/)
      expect(webcalUrl).toMatch(/^webcal:\/\/family\.example\.com\/api\/calendar\//)
    })

    it('refuses personal access tokens on every management route', async () => {
      const user = await createUser()
      const { token, tokenHash, tokenPreview } = generateApiToken()
      await prisma.apiToken.create({ data: { userId: user.id, name: 'script', tokenHash, tokenPreview } })
      const headers = { authorization: `Bearer ${token}` }

      for (const method of ['GET', 'POST', 'DELETE'] as const) {
        const res = await app.inject({ method, url: '/api/auth/me/calendar-feed', headers })
        expect(res.statusCode).toBe(403)
      }
      expect(await prisma.calendarFeedToken.count({ where: { userId: user.id } })).toBe(0)
    })

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/me/calendar-feed' })
      expect(res.statusCode).toBe(401)
    })

    it('is removed with the account', async () => {
      const user = await createUser()
      await enableFeed(user)
      await prisma.user.delete({ where: { id: user.id } })
      expect(await prisma.calendarFeedToken.count({ where: { userId: user.id } })).toBe(0)
    })

    it('advertises the calendarFeed server feature', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/server-info' })
      expect(res.json().features).toContain('calendarFeed')
    })
  })

  describe('feed endpoint', () => {
    it('404s for unknown and malformed tokens', async () => {
      expect((await fetchFeed(`/api/calendar/famlin_cal_${'A'.repeat(43)}/famlin.ics`)).statusCode).toBe(404)
      expect((await fetchFeed('/api/calendar/nonsense/famlin.ics')).statusCode).toBe(404)
    })

    it('serves an iCalendar document with private, noindex headers', async () => {
      const user = await createUser()
      const { path } = await enableFeed(user)
      const res = await fetchFeed(path)
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8')
      expect(res.headers['x-robots-tag']).toBe('noindex')
      expect(res.headers['cache-control']).toMatch(/^private/)
      expect(res.body.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
      expect(res.body).toContain('METHOD:PUBLISH\r\n')
      expect(res.body).toContain('X-WR-CALNAME:Famlin\r\n')
      expect(res.body.endsWith('END:VCALENDAR\r\n')).toBe(true)
      // Every line break is CRLF.
      expect(res.body.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)

      // lastUsedAt is tracked (fire-and-forget, so poll briefly).
      for (let i = 0; i < 20; i++) {
        const row = await prisma.calendarFeedToken.findUniqueOrThrow({ where: { userId: user.id } })
        if (row.lastUsedAt) break
        await new Promise((r) => setTimeout(r, 25))
      }
      expect((await prisma.calendarFeedToken.findUniqueOrThrow({ where: { userId: user.id } })).lastUsedAt).toBeTruthy()
    })

    it('maps an event to a VEVENT, with no link while publicUrl is unset', async () => {
      const author = await createUser({ name: 'Grandma' })
      const viewer = await createUser()
      const group = await createGroupWithMember(author, { name: 'The Smiths' })
      await addMember(group.id, viewer.id)
      const startsAt = new Date(Date.now() + 3 * DAY)
      startsAt.setUTCMilliseconds(0)
      const event = await createEvent(author, { groupId: group.id }, 'Lunch; with, everyone', {
        startsAt: startsAt.toISOString(),
        location: 'Grandma’s house, Main St',
      })
      await app.inject({
        method: 'POST',
        url: `/api/posts/${event.id}/comments`,
        headers: authHeader(viewer),
        payload: { content: 'SECRET-COMMENT-TEXT' },
      })

      const { ics, events } = await feedEvents(viewer)
      expect(events).toHaveLength(1)
      const [vevent] = events
      expect(vevent.UID).toBe(`${event.id}@localhost`)
      expect(vevent.SUMMARY).toBe('Lunch\\; with\\, everyone')
      expect(vevent.LOCATION).toBe('Grandma’s house\\, Main St')
      expect(vevent.DTSTART).toBe(formatIcalDate(startsAt))
      // No end time → one hour.
      expect(vevent.DTEND).toBe(formatIcalDate(new Date(startsAt.getTime() + 60 * 60_000)))
      expect(vevent.DTSTAMP).toMatch(/^\d{8}T\d{6}Z$/)
      expect(vevent['LAST-MODIFIED']).toMatch(/^\d{8}T\d{6}Z$/)
      expect(vevent.DESCRIPTION).toContain('Family: The Smiths')
      expect(vevent.DESCRIPTION).toContain('Posted by Grandma')
      expect(vevent.STATUS).toBeUndefined()
      expect(vevent.URL).toBeUndefined()
      expect(ics).not.toContain('/posts/')
      expect(ics).not.toContain('SECRET-COMMENT-TEXT')
    })

    it('links the post and uses the publicUrl host for UIDs when publicUrl is set', async () => {
      await updateSettings({ publicUrl: 'https://family.example.com' })
      const user = await createUser()
      const group = await createGroupWithMember(user)
      const startsAt = new Date(Date.now() + DAY).toISOString()
      const endsAt = new Date(Date.now() + DAY + 3 * 60 * 60_000).toISOString()
      const event = await createEvent(user, { groupId: group.id }, 'Picnic', { startsAt, endsAt })

      const { events } = await feedEvents(user)
      expect(events[0].UID).toBe(`${event.id}@family.example.com`)
      expect(events[0].URL).toBe(`https://family.example.com/posts/${event.id}`)
      expect(events[0].DESCRIPTION).toContain(`https://family.example.com/posts/${event.id}`)
      expect(events[0].DTEND).toBe(formatIcalDate(new Date(endsAt)))
    })

    it('includes future events and the past three months, and only EVENT posts', async () => {
      const user = await createUser()
      const group = await createGroupWithMember(user)
      await insertEvent(user, group.id, 'Last month', new Date(Date.now() - 30 * DAY))
      await insertEvent(user, group.id, 'Next year', new Date(Date.now() + 365 * DAY))
      await insertEvent(user, group.id, 'Half a year ago', new Date(Date.now() - 180 * DAY))
      await prisma.post.create({
        data: { authorId: user.id, groupId: group.id, content: 'Just an update', uploadedAssetUrls: [] },
      })

      const { events } = await feedEvents(user)
      expect(events.map((e) => e.SUMMARY).sort()).toEqual(['Last month', 'Next year'])
    })

    it('only shows events from families and circles the subscriber is in, recomputed every fetch', async () => {
      const author = await createUser()
      const member = await createUser()
      const outsider = await createUser()
      const group = await createGroupWithMember(author)
      await addMember(group.id, member.id)
      await addMember(group.id, outsider.id)
      const otherGroup = await createGroupWithMember(author)

      const circle = await prisma.circle.create({
        data: {
          groupId: group.id,
          name: 'Siblings',
          members: { create: [{ userId: author.id }, { userId: member.id }] },
        },
      })
      const soon = new Date(Date.now() + 2 * DAY)
      await insertEvent(author, group.id, 'Family dinner', soon)
      await insertEvent(author, group.id, 'Surprise party', soon, { circleId: circle.id })
      await insertEvent(author, otherGroup.id, 'Other family BBQ', soon)

      const memberFeed = await enableFeed(member)
      const outsiderFeed = await enableFeed(outsider)
      const summaries = async (path: string) =>
        parseEvents((await fetchFeed(path)).body)
          .map((e) => e.SUMMARY)
          .sort()

      expect(await summaries(memberFeed.path)).toEqual(['Family dinner', 'Surprise party'])
      expect(await summaries(outsiderFeed.path)).toEqual(['Family dinner'])

      // Removed from the circle → the circle event is gone on the next fetch.
      await prisma.circleMember.deleteMany({ where: { circleId: circle.id, userId: member.id } })
      expect(await summaries(memberFeed.path)).toEqual(['Family dinner'])

      // Removed from the family → nothing left.
      await prisma.groupMember.deleteMany({ where: { groupId: group.id, userId: member.id } })
      expect(await summaries(memberFeed.path)).toEqual([])
    })

    it('lists a cross-posted event once, with a crossPostId UID that survives edits', async () => {
      const author = await createUser()
      const groupA = await createGroupWithMember(author, { name: 'Alpha family' })
      const groupB = await createGroupWithMember(author, { name: 'Beta family' })
      const event = await createEvent(author, { groupIds: [groupA.id, groupB.id] }, 'Reunion')
      const { crossPostId } = await prisma.post.findUniqueOrThrow({ where: { id: event.id } })
      expect(crossPostId).toBeTruthy()

      const { path } = await enableFeed(author)
      let events = parseEvents((await fetchFeed(path)).body)
      expect(events).toHaveLength(1)
      expect(events[0].UID).toBe(`${crossPostId}@localhost`)
      expect(events[0].DESCRIPTION).toContain('Alpha family\\, Beta family')

      const edit = await app.inject({
        method: 'PATCH',
        url: `/api/posts/${event.id}`,
        headers: authHeader(author),
        payload: { content: 'Big reunion' },
      })
      expect(edit.statusCode).toBe(200)

      events = parseEvents((await fetchFeed(path)).body)
      expect(events).toHaveLength(1)
      expect(events[0].UID).toBe(`${crossPostId}@localhost`)
      expect(events[0].SUMMARY).toBe('Big reunion')
    })

    it("maps the subscriber's own RSVP, including one left on a sibling copy", async () => {
      const author = await createUser()
      const guest = await createUser()
      const groupA = await createGroupWithMember(author, { name: 'A family' })
      const groupB = await createGroupWithMember(author, { name: 'B family' })
      await addMember(groupA.id, guest.id)
      await addMember(groupB.id, guest.id)

      const yes = await createEvent(author, { groupId: groupA.id }, 'Yes event')
      const maybe = await createEvent(author, { groupId: groupA.id }, 'Maybe event')
      const no = await createEvent(author, { groupId: groupA.id }, 'No event')
      await createEvent(author, { groupId: groupA.id }, 'Unanswered event')
      const crossPosted = await createEvent(author, { groupIds: [groupA.id, groupB.id] }, 'Sibling event')

      const answer = (postId: string, value: string) =>
        app.inject({
          method: 'POST',
          url: `/api/posts/${postId}/interactions`,
          headers: authHeader(guest),
          payload: { key: 'rsvp', value },
        })
      await answer(yes.id, 'yes')
      await answer(maybe.id, 'maybe')
      await answer(no.id, 'no')

      // The RSVP lives on the copy in family B, while the feed picks the copy
      // in family A (sorts first) as the representative.
      const { crossPostId } = await prisma.post.findUniqueOrThrow({ where: { id: crossPosted.id } })
      const siblingInB = await prisma.post.findFirstOrThrow({ where: { crossPostId, groupId: groupB.id } })
      expect((await answer(siblingInB.id, 'yes')).statusCode).toBe(200)
      expect(await prisma.postInteraction.count({ where: { postId: siblingInB.id, userId: guest.id } })).toBe(1)

      const { events } = await feedEvents(guest)
      const bySummary = new Map(events.map((e) => [e.SUMMARY, e]))
      expect(bySummary.get('Yes event')!.STATUS).toBe('CONFIRMED')
      expect(bySummary.get('Yes event')!.DESCRIPTION).toContain("You're going")
      expect(bySummary.get('Maybe event')!.STATUS).toBe('TENTATIVE')
      expect(bySummary.get('No event')!.STATUS).toBeUndefined()
      expect(bySummary.get('No event')!.DESCRIPTION).toContain('You declined')
      expect(bySummary.get('Unanswered event')!.STATUS).toBeUndefined()
      expect(bySummary.get('Unanswered event')!.DESCRIPTION).not.toMatch(/You (declined|might|'re going)/)
      expect(bySummary.get('Sibling event')!.STATUS).toBe('CONFIRMED')
      expect(bySummary.get('Sibling event')!.UID).toBe(`${crossPostId}@localhost`)

      // Someone else's RSVP never shows up as the subscriber's.
      const { events: authorEvents } = await feedEvents(author)
      expect(authorEvents.every((e) => e.STATUS === undefined)).toBe(true)
    })

    it('rate-limits per token, not per client address', async () => {
      const busy = await enableFeed(await createUser())
      const quiet = await enableFeed(await createUser())
      let last = 0
      for (let i = 0; i < 121; i++) last = (await fetchFeed(busy.path)).statusCode
      expect(last).toBe(429)
      // Same client address, different token: its own budget.
      expect((await fetchFeed(quiet.path)).statusCode).toBe(200)
    })

    it('still caps one client address spraying guessed tokens', async () => {
      // Every guessed token would otherwise get a fresh per-token bucket.
      const guess = (i: number) => `/api/calendar/famlin_cal_${String(i).padStart(43, 'x')}/famlin.ics`
      const fromSprayer = (url: string) => app.inject({ method: 'GET', url, remoteAddress: '203.0.113.7' })
      let last = 0
      for (let i = 0; i < 301; i++) last = (await fromSprayer(guess(i))).statusCode
      expect(last).toBe(429)
      // Another address is unaffected.
      const real = await enableFeed(await createUser())
      expect((await app.inject({ method: 'GET', url: real.path, remoteAddress: '203.0.113.8' })).statusCode).toBe(200)
    })

    it('translates descriptions into the server default language', async () => {
      await updateSettings({ defaultLanguage: 'nl' })
      try {
        const user = await createUser({ name: 'Opa' })
        const group = await createGroupWithMember(user, { name: 'De Jansens' })
        await createEvent(user, { groupId: group.id }, 'Etentje')
        const { events } = await feedEvents(user)
        expect(events[0].DESCRIPTION).toContain('Familie: De Jansens')
        expect(events[0].DESCRIPTION).toContain('Geplaatst door Opa')
      } finally {
        await updateSettings({ defaultLanguage: 'en' })
      }
    })
  })
})
