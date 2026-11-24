import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { RESTORABLE_SETTING_KEYS } from '../src/services/settings.js'
import { buildTestApp, createUser, createGroup, addMember, authHeader } from './helpers.js'

let app: FastifyInstance
let admin: Awaited<ReturnType<typeof createUser>>
let alice: Awaited<ReturnType<typeof createUser>>
let bob: Awaited<ReturnType<typeof createUser>>
let conversationId: string
let familyConversationId: string

const b64 = (n: number) => Buffer.alloc(n, 1).toString('base64')
const patch = (payload: object) =>
  app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: authHeader(admin), payload })
const info = async () => (await app.inject({ method: 'GET', url: '/api/auth/server-info' })).json()
const get = (user: typeof alice, url: string) => app.inject({ method: 'GET', url, headers: authHeader(user) })

beforeAll(async () => {
  app = await buildTestApp()
  admin = await createUser({ isAdmin: true })
  alice = await createUser({ name: 'Alice' })
  bob = await createUser({ name: 'Bob' })
  const group = await createGroup()
  for (const u of [alice, bob]) await addMember(group.id, u.id)
  await prisma.group.update({ where: { id: group.id }, data: { chitchatEnabled: true } })
  familyConversationId = (await prisma.chatConversation.create({ data: { kind: 'FAMILY', groupId: group.id } })).id
  const created = await app.inject({
    method: 'POST',
    url: '/api/chat/conversations',
    headers: authHeader(alice),
    payload: { kind: 'PRIVATE', participantIds: [bob.id] },
  })
  conversationId = created.json().id
})

afterEach(async () => {
  await patch({ directMessagesEnabled: true, directMessagesOnWeb: false, e2eDirectMessagesEnabled: true })
})

afterAll(async () => {
  await app.close()
})

describe('direct message settings', () => {
  it('has the documented defaults and round-trips through PATCH', async () => {
    expect(await info()).toMatchObject({ directMessages: { enabled: true, web: false, encryption: true } })
    const res = await patch({ directMessagesOnWeb: true })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ directMessagesEnabled: true, directMessagesOnWeb: true })
    const read = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: authHeader(admin) })
    expect(read.json()).toMatchObject({ directMessagesOnWeb: true, e2eDirectMessagesEnabled: true })
  })

  it('survives export/restore', () => {
    for (const key of ['directMessagesEnabled', 'directMessagesOnWeb', 'e2eDirectMessagesEnabled'] as const) {
      expect(RESTORABLE_SETTING_KEYS).toContain(key)
    }
  })

  it.each([
    [{}, ['directMessages', 'e2eDirectMessages'], { enabled: true, web: false, encryption: true }],
    [
      { directMessagesOnWeb: true },
      ['directMessages', 'e2eDirectMessages'],
      { enabled: true, web: true, encryption: true },
    ],
    [{ e2eDirectMessagesEnabled: false }, ['directMessages'], { enabled: true, web: false, encryption: false }],
    [
      { directMessagesEnabled: false, directMessagesOnWeb: true },
      [],
      { enabled: false, web: false, encryption: false },
    ],
  ])('server-info for %j', async (settings, present, block) => {
    await patch(settings)
    const body = await info()
    expect(body.directMessages).toEqual(block)
    for (const id of ['directMessages', 'e2eDirectMessages']) {
      expect(body.features.includes(id)).toBe(present.includes(id))
    }
    expect(body.features).toContain('calendarFeed')
  })

  it('blocks every private-conversation path when disabled, but not family chat', async () => {
    const stored = await app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${conversationId}/messages`,
      headers: authHeader(alice),
      payload: { content: 'hello' },
    })
    expect(stored.statusCode).toBe(200)
    const messageId = stored.json().id

    await patch({ directMessagesEnabled: false })
    const denied = (res: { statusCode: number; json: () => { error: string } }) => {
      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBeTruthy()
    }
    denied(await get(alice, '/api/chat/people'))
    denied(
      await app.inject({
        method: 'POST',
        url: '/api/chat/conversations',
        headers: authHeader(alice),
        payload: { kind: 'PRIVATE', participantIds: [bob.id] },
      })
    )
    denied(await get(alice, `/api/chat/conversations/${conversationId}/messages`))
    denied(
      await app.inject({
        method: 'POST',
        url: `/api/chat/conversations/${conversationId}/messages`,
        headers: authHeader(alice),
        payload: { content: 'nope' },
      })
    )
    denied(
      await app.inject({
        method: 'POST',
        url: `/api/chat/conversations/${conversationId}/read`,
        headers: authHeader(alice),
      })
    )
    denied(
      await app.inject({
        method: 'PUT',
        url: `/api/chat/conversations/${conversationId}/encryption`,
        headers: authHeader(alice),
        payload: { enabled: false },
      })
    )
    denied(await app.inject({ method: 'DELETE', url: `/api/chat/messages/${messageId}`, headers: authHeader(alice) }))

    const list = (await get(alice, '/api/chat/conversations')).json()
    expect(list.items.map((c: { id: string }) => c.id)).toEqual([familyConversationId])
    const unread = (await get(bob, '/api/chat/conversations/unread')).json()
    expect(unread.byConversation[conversationId]).toBeUndefined()
    // Family chat is untouched, and the data is kept.
    expect((await get(alice, `/api/chat/conversations/${familyConversationId}/messages`)).statusCode).toBe(200)
    expect(await prisma.chatMessage.count({ where: { conversationId } })).toBe(1)

    await patch({ directMessagesEnabled: true })
    expect((await get(alice, `/api/chat/conversations/${conversationId}/messages`)).statusCode).toBe(200)
    const back = (await get(alice, '/api/chat/conversations')).json()
    expect(back.items.map((c: { id: string }) => c.id)).toContain(conversationId)
  })

  it('rejects encrypted messages but accepts plaintext when encryption is off', async () => {
    await patch({ e2eDirectMessagesEnabled: false })
    const encrypted = await app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${conversationId}/messages`,
      headers: authHeader(alice),
      payload: {
        encryption: 'v1',
        encryptedPayload: {
          v: 1,
          senderKeyVersion: 1,
          nonce: b64(24),
          ct: b64(64),
          keys: [alice, bob].map((u) => ({
            userId: u.id,
            keyVersion: 1,
            epk: b64(32),
            nonce: b64(24),
            wk: b64(48),
          })),
          sig: b64(64),
        },
      },
    })
    expect(encrypted.statusCode).toBe(403)
    const plain = await app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${conversationId}/messages`,
      headers: authHeader(alice),
      payload: { content: 'plain still works' },
    })
    expect(plain.statusCode).toBe(200)
  })
})
