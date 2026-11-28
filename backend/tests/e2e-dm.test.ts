import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { prisma } from '../src/db.js'
import { uploadsDir } from '../src/config.js'
import { canReadUpload } from '../src/services/uploads.js'
import { invalidateSettingsCache } from '../src/services/settings.js'
import { buildTestApp, createUser, createGroup, addMember, authHeader } from './helpers.js'

const b64 = (n: number, fill = 1) => Buffer.alloc(n, fill).toString('base64')
const backup = { v: 1, salt: b64(16), nonce: b64(24), ct: b64(48) }
const identityBody = (version: number, fill = 1, extra: object = {}) => ({
  version,
  signPublicKey: b64(32, fill),
  boxPublicKey: b64(32, fill + 1),
  ...extra,
})

function envelope(keys: Array<{ userId: string; keyVersion: number }>, senderKeyVersion = 1) {
  return {
    v: 1,
    senderKeyVersion,
    nonce: b64(24),
    ct: b64(64),
    keys: keys.map((k) => ({ ...k, epk: b64(32), nonce: b64(24), wk: b64(48) })),
    sig: b64(64),
  }
}

function multipart(filename: string, data: Buffer) {
  const boundary = '----FamlinE2eBoundary'
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

let app: FastifyInstance
let alice: Awaited<ReturnType<typeof createUser>>
let bob: Awaited<ReturnType<typeof createUser>>
let carol: Awaited<ReturnType<typeof createUser>>
let stranger: Awaited<ReturnType<typeof createUser>>
let conversationId: string
let familyConversationId: string
const h = (u: Awaited<ReturnType<typeof createUser>>) => authHeader(u)

async function putIdentity(user: typeof alice, version: number, fill = 1, extra: object = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/e2e/identity',
    headers: h(user),
    payload: identityBody(version, fill, extra),
  })
}

async function send(user: typeof alice, payload: object, convo = conversationId) {
  return app.inject({
    method: 'POST',
    url: `/api/chat/conversations/${convo}/messages`,
    headers: h(user),
    payload,
  })
}

async function uploadEncrypted(user: typeof alice, data = Buffer.from('opaque-bytes')) {
  const { body, contentType } = multipart('x.bin', data)
  return app.inject({
    method: 'POST',
    url: '/api/uploads/encrypted',
    headers: { ...h(user), 'content-type': contentType },
    payload: body,
  })
}

beforeAll(async () => {
  app = await buildTestApp()
  // End-to-end encryption is opt-in per server (off by default).
  await prisma.setting.upsert({
    where: { key: 'e2eDirectMessagesEnabled' },
    create: { key: 'e2eDirectMessagesEnabled', value: 'true' },
    update: { value: 'true' },
  })
  invalidateSettingsCache()
  alice = await createUser({ name: 'Alice' })
  bob = await createUser({ name: 'Bob' })
  carol = await createUser({ name: 'Carol' })
  stranger = await createUser({ name: 'Stranger' })
  const group = await createGroup()
  for (const u of [alice, bob, carol]) await addMember(group.id, u.id)
  const created = await app.inject({
    method: 'POST',
    url: '/api/chat/conversations',
    headers: h(alice),
    payload: { kind: 'PRIVATE', participantIds: [bob.id] },
  })
  conversationId = created.json().id
  const family = await prisma.chatConversation.create({ data: { kind: 'FAMILY', groupId: group.id } })
  await prisma.group.update({ where: { id: group.id }, data: { chitchatEnabled: true } })
  familyConversationId = family.id
})

afterAll(async () => {
  await app.close()
})

describe('E2E identity directory', () => {
  it('creates versions in order and rejects conflicts', async () => {
    expect((await putIdentity(alice, 2)).statusCode).toBe(409)
    const first = await putIdentity(alice, 1, 1, { recoveryBackup: backup })
    expect(first.statusCode).toBe(201)
    expect(first.json().recoveryBackup).toBeUndefined()
    expect((await putIdentity(alice, 1)).statusCode).toBe(409)
    expect((await putIdentity(alice, 2, 5)).statusCode).toBe(201)

    const me = await app.inject({ method: 'GET', url: '/api/e2e/identity/me', headers: h(alice) })
    const identities = me.json().identities
    expect(identities.map((i: { version: number }) => i.version)).toEqual([2, 1])
    expect(identities[1].recoveryBackup).toEqual(backup)
    expect(identities[0].recoveryBackup).toBeNull()
  })

  it('validates key lengths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/e2e/identity',
      headers: h(bob),
      payload: { version: 1, signPublicKey: b64(16), boxPublicKey: b64(32) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('updates the recovery backup only on the latest version', async () => {
    const stale = await app.inject({
      method: 'PUT',
      url: '/api/e2e/identity/1/recovery',
      headers: h(alice),
      payload: { recoveryBackup: backup },
    })
    expect(stale.statusCode).toBe(409)
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/e2e/identity/2/recovery',
      headers: h(alice),
      payload: { recoveryBackup: backup },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().recoveryBackup).toEqual(backup)
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/e2e/identity/2/recovery',
      headers: h(alice),
      payload: { recoveryBackup: null },
    })
    expect(cleared.json().recoveryBackup).toBeNull()
  })

  it('shows public identities to family and self, 404 to strangers, never the backup', async () => {
    const asBob = await app.inject({ method: 'GET', url: `/api/e2e/identity/${alice.id}`, headers: h(bob) })
    expect(asBob.statusCode).toBe(200)
    expect(asBob.json().identities).toHaveLength(2)
    expect(JSON.stringify(asBob.json())).not.toContain('recoveryBackup')
    const self = await app.inject({ method: 'GET', url: `/api/e2e/identity/${alice.id}`, headers: h(alice) })
    expect(self.statusCode).toBe(200)
    const stranger404 = await app.inject({
      method: 'GET',
      url: `/api/e2e/identity/${alice.id}`,
      headers: h(stranger),
    })
    expect(stranger404.statusCode).toBe(404)
    const empty = await app.inject({ method: 'GET', url: `/api/e2e/identity/${carol.id}`, headers: h(bob) })
    expect(empty.json()).toEqual({ userId: carol.id, identities: [] })
  })

  it('rejects API tokens on mutating routes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/api-tokens',
      headers: h(carol),
      payload: { name: 'pat' },
    })
    const pat = { authorization: `Bearer ${created.json().token}` }
    const res = await app.inject({
      method: 'POST',
      url: '/api/e2e/identity',
      headers: pat,
      payload: identityBody(1, 9),
    })
    expect(res.statusCode).toBe(403)
    const get = await app.inject({ method: 'GET', url: `/api/e2e/identity/${alice.id}`, headers: pat })
    expect(get.statusCode).toBe(200)
  })
})

describe('E2E transfer relay', () => {
  const sessionId = `transfer-${randomUUID()}`
  const payload = { v: 1, epk: b64(32), nonce: b64(24), ct: b64(100) }

  it('is one-shot and scoped to the same user', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/e2e/transfers/${sessionId}`,
      headers: h(alice),
      payload: { payload },
    })
    expect(put.statusCode).toBe(200)
    const again = await app.inject({
      method: 'PUT',
      url: `/api/e2e/transfers/${sessionId}`,
      headers: h(alice),
      payload: { payload },
    })
    expect(again.statusCode).toBe(409)
    const other = await app.inject({ method: 'GET', url: `/api/e2e/transfers/${sessionId}`, headers: h(bob) })
    expect(other.statusCode).toBe(404)
    const got = await app.inject({ method: 'GET', url: `/api/e2e/transfers/${sessionId}`, headers: h(alice) })
    expect(got.statusCode).toBe(200)
    expect(got.json().payload).toEqual(payload)
    const gone = await app.inject({ method: 'GET', url: `/api/e2e/transfers/${sessionId}`, headers: h(alice) })
    expect(gone.statusCode).toBe(404)
  })

  it('rejects malformed session ids and payloads', async () => {
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/e2e/transfers/short',
      headers: h(alice),
      payload: { payload },
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe('encrypted direct messages', () => {
  it('rejects while a participant has no identity, then accepts', async () => {
    const noKey = await send(alice, {
      encryption: 'v1',
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 2 },
          { userId: bob.id, keyVersion: 1 },
        ],
        2
      ),
    })
    expect(noKey.statusCode).toBe(409)
    await putIdentity(bob, 1, 20)

    const ok = await send(alice, {
      encryption: 'v1',
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 2 },
          { userId: bob.id, keyVersion: 1 },
        ],
        2
      ),
    })
    expect(ok.statusCode).toBe(200)
    const body = ok.json()
    expect(body.encryption).toBe('v1')
    expect(body.content).toBeNull()
    expect(body.encryptedPayload.ct).toBeTruthy()
    const row = await prisma.chatMessage.findUnique({ where: { id: body.id } })
    expect(row?.content).toBeNull()
  })

  it('rejects stale versions, wrong recipients and malformed envelopes', async () => {
    const stale = await send(alice, {
      encryption: 'v1',
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 1 },
          { userId: bob.id, keyVersion: 1 },
        ],
        1
      ),
    })
    expect(stale.statusCode).toBe(409)
    const wrongSet = await send(alice, {
      encryption: 'v1',
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 2 },
          { userId: carol.id, keyVersion: 1 },
        ],
        2
      ),
    })
    expect(wrongSet.statusCode).toBe(400)
    const onlyOne = await send(alice, {
      encryption: 'v1',
      encryptedPayload: envelope([{ userId: alice.id, keyVersion: 2 }], 2),
    })
    expect(onlyOne.statusCode).toBe(400)
    const withContent = await send(alice, {
      encryption: 'v1',
      content: 'plaintext leak',
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 2 },
          { userId: bob.id, keyVersion: 1 },
        ],
        2
      ),
    })
    expect(withContent.statusCode).toBe(400)
  })

  it('rejects v1 in family chat', async () => {
    const res = await send(
      alice,
      {
        encryption: 'v1',
        encryptedPayload: envelope([{ userId: alice.id, keyVersion: 2 }], 2),
      },
      familyConversationId
    )
    expect(res.statusCode).toBe(400)
  })

  it('stores encrypted blobs unprocessed, readable only by participants', async () => {
    const res = await uploadEncrypted(alice, Buffer.from('ciphertext-bytes'))
    expect(res.statusCode).toBe(201)
    const url: string = res.json().url
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.bin$/)
    const row = await prisma.upload.findFirst({ where: { mediaUrl: url } })
    expect(row?.mediaKind).toBe('encrypted')
    expect(row?.processingStatus).toBe('ready')
    expect(fs.readFileSync(path.join(uploadsDir, path.basename(url))).toString()).toBe('ciphertext-bytes')
    expect(fs.existsSync(path.join(uploadsDir, path.basename(url).replace('.bin', '-thumbnail.jpg')))).toBe(false)

    const sent = await send(alice, {
      encryption: 'v1',
      attachmentUrl: url,
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 2 },
          { userId: bob.id, keyVersion: 1 },
        ],
        2
      ),
    })
    expect(sent.statusCode).toBe(200)
    expect(sent.json().attachmentUrl).toBe(url)

    expect(await canReadUpload(url, bob.id)).toBe(true)
    expect(await canReadUpload(url, alice.id)).toBe(true)
    expect(await canReadUpload(url, carol.id)).toBe(false)
    const served = await app.inject({ method: 'GET', url, headers: h(bob) })
    expect(served.statusCode).toBe(200)
    expect(served.headers['content-type']).toContain('application/octet-stream')
    const denied = await app.inject({ method: 'GET', url, headers: h(carol) })
    expect(denied.statusCode).toBe(404)
  })

  it('keeps encrypted and plaintext attachments apart', async () => {
    const enc = (await uploadEncrypted(alice)).json().url as string
    const plain = await send(alice, { content: 'hi', attachmentUrl: enc })
    expect(plain.statusCode).toBe(400)

    const jpg = `/uploads/${randomUUID()}.jpg`
    await prisma.upload.create({
      data: { assetKey: path.basename(jpg, '.jpg'), uploaderId: alice.id, mediaUrl: jpg },
    })
    const mismatch = await send(alice, {
      encryption: 'v1',
      attachmentUrl: jpg,
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 2 },
          { userId: bob.id, keyVersion: 1 },
        ],
        2
      ),
    })
    expect(mismatch.statusCode).toBe(400)
  })
})

describe('encryption toggle and listings', () => {
  it('creates one system message per change and is idempotent', async () => {
    const url = `/api/chat/conversations/${conversationId}/encryption`
    const off = await app.inject({ method: 'PUT', url, headers: h(bob), payload: { enabled: false } })
    expect(off.statusCode).toBe(200)
    expect(off.json().encryptionDisabledAt).toBeTruthy()
    expect(off.json().encryptionDisabledById).toBe(bob.id)
    const again = await app.inject({ method: 'PUT', url, headers: h(alice), payload: { enabled: false } })
    expect(again.json().encryptionDisabledById).toBe(bob.id)
    expect(await prisma.chatMessage.count({ where: { conversationId, kind: 'SYSTEM_ENCRYPTION_DISABLED' } })).toBe(1)

    // Plaintext and encrypted both still accepted while disabled.
    expect((await send(alice, { content: 'plain while off' })).statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/api/chat/conversations', headers: h(alice) })
    const summary = list.json().items.find((c: { id: string }) => c.id === conversationId)
    expect(summary.encryptionDisabledAt).toBeTruthy()

    const on = await app.inject({ method: 'PUT', url, headers: h(alice), payload: { enabled: true } })
    expect(on.json().encryptionDisabledAt).toBeNull()
    expect(await prisma.chatMessage.count({ where: { conversationId, kind: 'SYSTEM_ENCRYPTION_ENABLED' } })).toBe(1)
  })

  it('404s for non-participants and 400s for family chat', async () => {
    const non = await app.inject({
      method: 'PUT',
      url: `/api/chat/conversations/${conversationId}/encryption`,
      headers: h(carol),
      payload: { enabled: false },
    })
    expect(non.statusCode).toBe(404)
    const fam = await app.inject({
      method: 'PUT',
      url: `/api/chat/conversations/${familyConversationId}/encryption`,
      headers: h(alice),
      payload: { enabled: false },
    })
    expect(fam.statusCode).toBe(400)
  })

  it('lists the ciphertext envelope for an encrypted last message', async () => {
    const sent = await send(alice, {
      encryption: 'v1',
      encryptedPayload: envelope(
        [
          { userId: alice.id, keyVersion: 2 },
          { userId: bob.id, keyVersion: 1 },
        ],
        2
      ),
    })
    const list = await app.inject({ method: 'GET', url: '/api/chat/conversations', headers: h(bob) })
    const summary = list.json().items.find((c: { id: string }) => c.id === conversationId)
    expect(summary.lastMessage.encryption).toBe('v1')
    expect(summary.lastMessage.content).toBeNull()
    expect(summary.lastMessage.encryptedPayload.ct).toBeTruthy()

    const reply = await send(bob, { content: 'quoting', replyToMessageId: sent.json().id })
    expect(reply.json().replyTo.content).toBeNull()
    expect(reply.json().replyTo.attachmentUrl).toBeNull()
    expect(reply.json().replyTo.encryption).toBe('v1')
  })
})
