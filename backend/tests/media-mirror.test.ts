import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createHash, randomUUID } from 'crypto'
import { prisma } from '../src/db.js'
import { updateSettings, __resetSettingsCacheForTests } from '../src/services/settings.js'
import { getStorage } from '../src/services/storage/registry.js'
import { runMediaMirrorJob, mirroredAssetIds, MAX_MIRROR_ATTEMPTS } from '../src/services/mediaMirror.js'
import { runNewAssetsJob } from '../src/jobs/newAssets.js'
import { immichProvider } from '../src/services/media/immich.js'
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader, createPost } from './helpers.js'

const SERVER = 'http://immich.test'

// A tiny in-memory Immich: just the endpoints the mirror uses.
class FakeImmich {
  albums = new Map<string, Set<string>>()
  assets = new Map<
    string,
    {
      id: string
      filename: string
      bytes: string
      livePhotoVideoId?: string
      hidden: boolean
      deviceId?: string
      deviceAssetId?: string
    }
  >()
  byChecksum = new Map<string, string>()
  down = false
  failUploads = false
  permissions: string[] = ['all']
  // Applies the next album add, then drops the connection before answering.
  dropNextAddResponse = false

  async handle(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.down) throw new TypeError('fetch failed')
    const { pathname } = new URL(url)
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
    let m: RegExpExecArray | null
    if (pathname === '/api/server/ping') return ok({ res: 'pong' })
    if (pathname === '/api/api-keys/me') return ok({ permissions: this.permissions })
    if (pathname === '/api/albums' && method === 'POST') {
      const id = randomUUID()
      this.albums.set(id, new Set())
      return ok({ id, albumName: body.albumName }, 201)
    }
    if ((m = /^\/api\/assets\/([^/]+)$/.exec(pathname))) {
      const asset = this.assets.get(m[1])
      return asset ? ok(asset) : ok({ message: 'Not found' }, 400)
    }
    if ((m = /^\/api\/albums\/([^/]+)$/.exec(pathname))) {
      return this.albums.has(m[1]) ? ok({ id: m[1] }) : ok({ message: 'Not found' }, 400)
    }
    if (pathname === '/api/search/metadata') {
      const ids = [...(this.albums.get(body.albumIds[0]) ?? [])]
      return ok({ assets: { items: ids.map((id) => ({ id })), nextPage: null } })
    }
    if (pathname === '/api/assets' && method === 'POST') {
      if (this.failUploads) return ok({ message: 'Unsupported file' }, 400)
      const form = init.body as FormData
      const file = form.get('assetData') as Blob
      const bytes = Buffer.from(await file.arrayBuffer()).toString()
      const checksum = (init.headers as Record<string, string>)['x-immich-checksum']
      expect(checksum).toBe(createHash('sha1').update(bytes).digest('hex'))
      const existing = this.byChecksum.get(checksum)
      if (existing) return ok({ id: existing, status: 'duplicate' })
      const id = randomUUID()
      this.byChecksum.set(checksum, id)
      this.assets.set(id, {
        id,
        bytes,
        filename: String(form.get('filename')),
        livePhotoVideoId: (form.get('livePhotoVideoId') as string | null) ?? undefined,
        hidden: form.get('visibility') === 'hidden',
        deviceId: String(form.get('deviceId')),
        deviceAssetId: String(form.get('deviceAssetId')),
      })
      return ok({ id, status: 'created' }, 201)
    }
    if ((m = /^\/api\/albums\/([^/]+)\/assets$/.exec(pathname))) {
      const album = this.albums.get(m[1])
      if (!album) return ok({ message: 'Not found' }, 400)
      const results = (body.ids as string[]).map((id) => {
        if (method === 'PUT') {
          if (!this.assets.has(id)) return { id, success: false, error: 'not_found' }
          if (album.has(id)) return { id, success: false, error: 'duplicate' }
          album.add(id)
          return { id, success: true }
        }
        return { id, success: album.delete(id) }
      })
      if (method === 'PUT' && this.dropNextAddResponse) {
        this.dropNextAddResponse = false
        throw new TypeError('socket hang up')
      }
      return ok(results)
    }
    return ok({ message: `unexpected ${method} ${pathname}` }, 500)
  }

  albumFiles(albumId: string) {
    return [...(this.albums.get(albumId) ?? [])].map((id) => this.assets.get(id)?.bytes)
  }
}

let immich: FakeImmich

// An uploaded photo exactly as POST /api/uploads leaves it once processed:
// the original under originals/<uuid>/<name>, a display copy, and a bound
// row scoped to `groupIds` (or a circle).
async function storeUpload(
  uploaderId: string,
  scope: { groupIds: string[]; circleId?: string },
  name = 'IMG_0001.HEIC',
  extra: Partial<{ motionAssetKey: string; mediaKind: string }> = {}
) {
  const assetKey = randomUUID()
  const original = `original-of-${assetKey}`
  await getStorage().put(`originals/${assetKey}/${name}`, Buffer.from(original))
  await getStorage().put(`${assetKey}.jpg`, Buffer.from(`display-${assetKey}`))
  await prisma.upload.create({
    data: {
      assetKey,
      uploaderId,
      bound: true,
      groupIds: scope.groupIds,
      circleId: scope.circleId ?? null,
      sourceFilename: `${assetKey}/${name}`,
      mediaUrl: `/uploads/${assetKey}.jpg`,
      processingStatus: 'ready',
      ...extra,
    },
  })
  return { url: `/uploads/${assetKey}.jpg`, assetKey, original }
}

async function enableMirror(groupId: string, albumId: string, mirrorSince = new Date(0)) {
  return prisma.mediaMirrorTarget.create({
    data: { groupId, externalAlbumId: albumId, albumName: 'Famlin – Family', mirrorSince },
  })
}

describe('Immich upload mirror', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    // Tables are only truncated between files; each test brings its own
    // fake Immich, so earlier tests' targets would point at unknown albums.
    await prisma.mediaMirrorTarget.deleteMany()
    await prisma.mediaMirror.deleteMany()
    immich = new FakeImmich()
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => immich.handle(String(input), init))
    await updateSettings({ immichServerUrl: SERVER, immichApiKey: 'read-key', immichMirrorApiKey: 'write-key' })
    __resetSettingsCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function setup() {
    const member = await createUser()
    const group = await createGroupWithMember(member)
    const albumId = randomUUID()
    immich.albums.set(albumId, new Set())
    await enableMirror(group.id, albumId)
    return { member, group, albumId }
  }

  it('uploads the original of a family-wide post photo into the album', async () => {
    const { member, group, albumId } = await setup()
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })

    const result = await runMediaMirrorJob()

    expect(result).toMatchObject({ albums: 1, uploaded: 1, failed: 0 })
    // The original, never the display copy, under its original filename.
    expect(immich.albumFiles(albumId)).toEqual([photo.original])
    expect([...immich.assets.values()][0].filename).toBe('IMG_0001.HEIC')
    const row = await prisma.mediaMirror.findFirstOrThrow({ where: { assetKey: photo.assetKey } })
    expect(row).toMatchObject({ status: 'mirrored', addedByFamlin: true })

    // A second run has nothing to do.
    expect(await runMediaMirrorJob()).toMatchObject({ uploaded: 0, removed: 0 })
  })

  it('never mirrors circle, gift-list or story media — even when a family post also uses it', async () => {
    const { member, group, albumId } = await setup()
    const circle = await prisma.circle.create({ data: { groupId: group.id, name: 'Inner', createdById: member.id } })
    await prisma.circleMember.create({ data: { circleId: circle.id, userId: member.id } })

    const circlePhoto = await storeUpload(member.id, { groupIds: [group.id], circleId: circle.id })
    await prisma.post.create({
      data: {
        groupId: group.id,
        circleId: circle.id,
        authorId: member.id,
        content: 'x',
        uploadedAssetUrls: [circlePhoto.url],
      },
    })
    // A family photo also reused in a circle post: one private reference keeps it out.
    const shared = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [shared.url] })
    await prisma.post.create({
      data: {
        groupId: group.id,
        circleId: circle.id,
        authorId: member.id,
        content: 'y',
        uploadedAssetUrls: [shared.url],
      },
    })
    // A story's photo referenced from a family post.
    const storyPhoto = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [storyPhoto.url] })
    await prisma.story.create({
      data: {
        groupId: group.id,
        authorId: member.id,
        imageUrl: storyPhoto.url,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    // A gift-list wish photo referenced from a family post.
    const wishPhoto = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [wishPhoto.url] })
    const giftCircle = await prisma.circle.create({
      data: { groupId: group.id, name: 'Gifts', kind: 'GIFT_LIST', createdById: member.id },
    })
    const giftPost = await prisma.post.create({
      data: { groupId: group.id, circleId: giftCircle.id, authorId: member.id, content: '', type: 'GIFT_LIST' },
    })
    await prisma.giftListItem.create({
      data: { postId: giftPost.id, ownerId: member.id, title: 'Bike', photoUrl: wishPhoto.url, position: 0 },
    })
    // A direct-message photo referenced by a family post stays private.
    const peer = await createUser()
    await addMember(group.id, peer.id)
    const conversation = await prisma.chatConversation.create({
      data: {
        kind: 'PRIVATE',
        participantKey: [member.id, peer.id].sort().join(':'),
        createdById: member.id,
        participants: { create: [{ userId: member.id }, { userId: peer.id }] },
      },
    })
    const directPhoto = await storeUpload(member.id, { groupIds: [group.id] })
    await prisma.upload.update({
      where: { assetKey: directPhoto.assetKey },
      data: {
        chatConversationId: conversation.id,
        participantUserIds: [member.id, peer.id].sort(),
        groupIds: [],
      },
    })
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: member.id,
        attachmentUrl: directPhoto.url,
      },
    })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [directPhoto.url] })

    const result = await runMediaMirrorJob()

    expect(result.uploaded).toBe(0)
    expect(immich.albumFiles(albumId)).toEqual([])
    expect(immich.assets.size).toBe(0)
    expect(await prisma.mediaMirror.count()).toBe(0)
  })

  it('removes a previously mirrored upload when it becomes direct-message media', async () => {
    const { member, group, albumId } = await setup()
    const peer = await createUser()
    await addMember(group.id, peer.id)
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    expect((await runMediaMirrorJob()).uploaded).toBe(1)
    expect(immich.albumFiles(albumId)).toHaveLength(1)

    const conversation = await prisma.chatConversation.create({
      data: {
        kind: 'PRIVATE',
        participantKey: [member.id, peer.id].sort().join(':'),
        createdById: member.id,
        participants: { create: [{ userId: member.id }, { userId: peer.id }] },
      },
    })
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: member.id,
        attachmentUrl: photo.url,
      },
    })
    await prisma.upload.update({
      where: { assetKey: photo.assetKey },
      data: {
        chatConversationId: conversation.id,
        participantUserIds: [member.id, peer.id].sort(),
        groupIds: [],
      },
    })

    expect(await runMediaMirrorJob()).toMatchObject({ removed: 1 })
    expect(immich.albumFiles(albumId)).toEqual([])
  })

  it('skips ordinary comment attachments, server copies, legacy rows and content before mirrorSince', async () => {
    const member = await createUser()
    const group = await createGroupWithMember(member)
    const albumId = randomUUID()
    immich.albums.set(albumId, new Set())
    await enableMirror(group.id, albumId, new Date())

    const old = await storeUpload(member.id, { groupIds: [group.id] })
    await prisma.post.create({
      data: {
        groupId: group.id,
        authorId: member.id,
        content: 'old',
        uploadedAssetUrls: [old.url],
        createdAt: new Date(Date.now() - 86_400_000),
      },
    })
    const post = await createPost({ groupId: group.id, authorId: member.id })
    const attachment = await storeUpload(member.id, { groupIds: [group.id] })
    await prisma.comment.create({
      data: {
        postId: post.id,
        authorId: member.id,
        content: '',
        attachmentUrls: [attachment.url],
        attachmentUrl: attachment.url,
      },
    })
    const copyKey = randomUUID()
    await prisma.upload.create({
      data: { assetKey: copyKey, uploaderId: member.id, bound: true, groupIds: [group.id] },
    })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [`/uploads/${copyKey}.jpg`] })

    expect((await runMediaMirrorJob()).uploaded).toBe(0)
  })

  it('mirrors album photos stored as comments', async () => {
    const { member, group, albumId } = await setup()
    const album = await prisma.post.create({
      data: { groupId: group.id, authorId: member.id, content: '', type: 'ALBUM', typeData: { title: 'Summer' } },
    })
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await prisma.comment.create({
      data: {
        postId: album.id,
        authorId: member.id,
        content: '',
        metadata: { kind: 'album_photo', contributionId: randomUUID(), photoUrls: [photo.url] },
      },
    })

    await runMediaMirrorJob()
    expect(immich.albumFiles(albumId)).toEqual([photo.original])
  })

  it('uploads a Live Photo video first, hidden, and links the still to it', async () => {
    const { member, group } = await setup()
    const motion = await storeUpload(member.id, { groupIds: [group.id] }, 'IMG_0002.MOV', { mediaKind: 'video' })
    const photo = await storeUpload(member.id, { groupIds: [group.id] }, 'IMG_0002.HEIC', {
      motionAssetKey: motion.assetKey,
    })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })

    await runMediaMirrorJob()

    const video = [...immich.assets.values()].find((a) => a.bytes === motion.original)!
    const still = [...immich.assets.values()].find((a) => a.bytes === photo.original)!
    expect(video.hidden).toBe(true)
    expect(still.livePhotoVideoId).toBe(video.id)
  })

  it('a cross-post into two families sharing one album is uploaded once', async () => {
    const member = await createUser()
    const a = await createGroupWithMember(member)
    const b = await createGroupWithMember(member)
    const albumId = randomUUID()
    immich.albums.set(albumId, new Set())
    await enableMirror(a.id, albumId)
    await enableMirror(b.id, albumId)
    const photo = await storeUpload(member.id, { groupIds: [a.id, b.id] })
    const crossPostId = randomUUID()
    for (const groupId of [a.id, b.id]) {
      await prisma.post.create({
        data: { groupId, authorId: member.id, content: 'x', uploadedAssetUrls: [photo.url], crossPostId },
      })
    }

    expect(await runMediaMirrorJob()).toMatchObject({ albums: 1, uploaded: 1 })
    expect(immich.albumFiles(albumId)).toHaveLength(1)
  })

  it('removes only what it added when the post is deleted, and never deletes the asset itself', async () => {
    const { member, group, albumId } = await setup()
    const mine = await storeUpload(member.id, { groupIds: [group.id] })
    const theirs = await storeUpload(member.id, { groupIds: [group.id] })
    // `theirs` was already in the album (phone backup): Immich dedupes it.
    const preexisting = randomUUID()
    immich.byChecksum.set(createHash('sha1').update(theirs.original).digest('hex'), preexisting)
    immich.assets.set(preexisting, { id: preexisting, filename: 'x', bytes: theirs.original, hidden: false })
    immich.albums.get(albumId)!.add(preexisting)

    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [mine.url, theirs.url] })
    await runMediaMirrorJob()
    expect(await prisma.mediaMirror.findFirstOrThrow({ where: { assetKey: theirs.assetKey } })).toMatchObject({
      addedByFamlin: false,
      status: 'mirrored',
    })

    await prisma.post.delete({ where: { id: post.id } })
    expect(await runMediaMirrorJob()).toMatchObject({ removed: 1 })

    expect([...immich.albums.get(albumId)!]).toEqual([preexisting])
    expect(immich.assets.size).toBe(2)
    expect(await prisma.mediaMirror.count()).toBe(0)
  })

  it('while paused adds nothing new but still takes deleted posts out', async () => {
    const { member, group, albumId } = await setup()
    const kept = await storeUpload(member.id, { groupIds: [group.id] })
    const deleted = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [kept.url] })
    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [deleted.url] })
    await runMediaMirrorJob()
    await prisma.mediaMirrorTarget.updateMany({ data: { enabled: false } })
    await prisma.post.delete({ where: { id: post.id } })
    const added = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [added.url] })

    expect(await runMediaMirrorJob()).toMatchObject({ uploaded: 0, removed: 1 })
    expect(immich.albumFiles(albumId)).toEqual([kept.original])
  })

  it("switching albums takes Famlin's photos out of the old album", async () => {
    const { member, group, albumId } = await setup()
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    await runMediaMirrorJob()
    const newAlbum = randomUUID()
    immich.albums.set(newAlbum, new Set())
    await prisma.mediaMirrorTarget.updateMany({ data: { externalAlbumId: newAlbum } })

    await runMediaMirrorJob()
    expect(immich.albumFiles(albumId)).toEqual([])
    expect(immich.albumFiles(newAlbum)).toEqual([photo.original])
    expect(await prisma.mediaMirror.count({ where: { externalAlbumId: albumId } })).toBe(0)
  })

  it('keeps ownership when the album add answer is lost, so the photo still comes out later', async () => {
    const { member, group, albumId } = await setup()
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    immich.dropNextAddResponse = true
    await expect(runMediaMirrorJob()).rejects.toThrow('could not be mirrored')
    expect(immich.albumFiles(albumId)).toEqual([photo.original])

    await runMediaMirrorJob()
    expect(await prisma.mediaMirror.findFirstOrThrow({ where: { assetKey: photo.assetKey } })).toMatchObject({
      status: 'mirrored',
      addedByFamlin: true,
    })
    await prisma.post.delete({ where: { id: post.id } })
    await runMediaMirrorJob()
    expect(immich.albumFiles(albumId)).toEqual([])
  })

  it('does nothing without an upload key', async () => {
    const { member, group } = await setup()
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    await updateSettings({ immichMirrorApiKey: '' })
    expect(await runMediaMirrorJob()).toEqual({ albums: 0, uploaded: 0, removed: 0, failed: 0 })
  })

  it('re-uploads an asset the album no longer has (e.g. after a restore onto another server)', async () => {
    const { member, group, albumId } = await setup()
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    await prisma.mediaMirror.create({
      data: {
        provider: 'immich',
        externalAlbumId: albumId,
        assetKey: photo.assetKey,
        externalAssetId: randomUUID(),
        addedByFamlin: true,
        status: 'mirrored',
      },
    })

    expect(await runMediaMirrorJob()).toMatchObject({ uploaded: 1 })
    expect(immich.albumFiles(albumId)).toEqual([photo.original])
  })

  it('records per-upload failures, retries a bounded number of times, and never touches the post', async () => {
    const { member, group } = await setup()
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    immich.failUploads = true

    for (let i = 0; i < MAX_MIRROR_ATTEMPTS + 2; i++) {
      await expect(runMediaMirrorJob()).rejects.toThrow('could not be mirrored')
    }
    const row = await prisma.mediaMirror.findFirstOrThrow({ where: { assetKey: photo.assetKey } })
    expect(row).toMatchObject({ status: 'failed', attempts: MAX_MIRROR_ATTEMPTS })
    expect(row.lastError).toContain('HTTP 400')
  })

  it('an unreachable Immich fails the run without spending attempts', async () => {
    const { member, group } = await setup()
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    immich.down = true

    await expect(runMediaMirrorJob()).rejects.toThrow()
    const row = await prisma.mediaMirror.findFirst({ where: { assetKey: photo.assetKey } })
    expect(row?.attempts ?? 0).toBe(0)
  })

  it('loop guard: mirrored assets are never "new" album assets', async () => {
    const { member, group, albumId } = await setup()
    const link = await prisma.mediaAlbumLink.create({
      data: {
        groupId: group.id,
        provider: 'immich',
        externalAlbumId: albumId,
        albumName: 'Famlin – Family',
        newAssetMode: 'AUTO',
        newAssetsCheckedAt: new Date(Date.now() - 60_000),
      },
    })
    const photo = await storeUpload(member.id, { groupIds: [group.id] })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    await runMediaMirrorJob()
    const [assetId] = await mirroredAssetIds('immich', albumId)
    expect(assetId).toBeTruthy()

    vi.spyOn(immichProvider, 'listAlbumAssets').mockResolvedValue([
      {
        id: assetId,
        type: 'IMAGE',
        width: 1,
        height: 1,
        originalExt: 'jpg',
        addedAt: new Date().toISOString(),
        takenAt: null,
      },
    ])
    await runNewAssetsJob()
    expect(await prisma.post.count({ where: { groupId: group.id } })).toBe(1)
    expect(link.id).toBeTruthy()
  })

  describe('admin routes', () => {
    it('creates a "Famlin – <family>" album and reports progress', async () => {
      const admin = await createUser({ isAdmin: true })
      const member = await createUser()
      const group = await createGroupWithMember(member, { name: 'Peeters' })
      await addMember(group.id, admin.id)

      const res = await app.inject({
        method: 'PUT',
        url: `/api/admin/groups/${group.id}/media-mirror`,
        headers: authHeader(admin),
        payload: { enabled: true, album: { mode: 'create' } },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.target).toMatchObject({ albumName: 'Famlin – Peeters', enabled: true })
      expect(immich.albums.has(body.target.externalAlbumId)).toBe(true)

      const get = await app.inject({
        method: 'GET',
        url: `/api/admin/groups/${group.id}/media-mirror`,
        headers: authHeader(admin),
      })
      expect(get.json()).toMatchObject({ configured: true, counts: { mirrored: 0, failed: 0 } })
    })

    it('requires an album the write key can see, and a configured key', async () => {
      const admin = await createUser({ isAdmin: true })
      const group = await createGroupWithMember(admin)
      const url = `/api/admin/groups/${group.id}/media-mirror`

      const missing = await app.inject({
        method: 'PUT',
        url,
        headers: authHeader(admin),
        payload: { enabled: true, album: { mode: 'existing', externalAlbumId: randomUUID(), albumName: 'Nope' } },
      })
      expect(missing.statusCode).toBe(400)
      expect(missing.json().code).toBe('album_not_found')

      const noAlbum = await app.inject({ method: 'PUT', url, headers: authHeader(admin), payload: { enabled: true } })
      expect(noAlbum.statusCode).toBe(400)

      await updateSettings({ immichMirrorApiKey: '' })
      const unconfigured = await app.inject({
        method: 'PUT',
        url,
        headers: authHeader(admin),
        payload: { enabled: true, album: { mode: 'create' } },
      })
      expect(unconfigured.statusCode).toBe(400)
      expect(unconfigured.json().code).toBe('not_configured')
    })

    it("refuses a mirror album linked to another family, and linking another family's mirror album", async () => {
      const admin = await createUser({ isAdmin: true })
      const a = await createGroupWithMember(admin)
      const b = await createGroupWithMember(admin)
      const linked = randomUUID()
      immich.albums.set(linked, new Set())
      await prisma.mediaAlbumLink.create({
        data: { groupId: b.id, provider: 'immich', externalAlbumId: linked, albumName: 'B' },
      })
      const res = await app.inject({
        method: 'PUT',
        url: `/api/admin/groups/${a.id}/media-mirror`,
        headers: authHeader(admin),
        payload: { enabled: true, album: { mode: 'existing', externalAlbumId: linked, albumName: 'B' } },
      })
      expect(res.statusCode).toBe(409)

      const mirror = randomUUID()
      await enableMirror(a.id, mirror)
      const link = await app.inject({
        method: 'POST',
        url: `/api/admin/groups/${b.id}/media-albums`,
        headers: authHeader(admin),
        payload: { provider: 'immich', externalAlbumId: mirror, albumName: 'A' },
      })
      expect(link.statusCode).toBe(409)
    })

    it('the connection test reports missing scopes, and never sends the saved key elsewhere', async () => {
      const admin = await createUser({ isAdmin: true })
      immich.permissions = ['asset.upload', 'album.read']
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/immich/mirror-test',
        headers: authHeader(admin),
        payload: { serverUrl: SERVER },
      })
      expect(res.json()).toEqual({
        ok: true,
        missingScopes: ['asset.read', 'album.create', 'albumAsset.create', 'albumAsset.delete', 'person.read'],
      })

      const elsewhere = await app.inject({
        method: 'POST',
        url: '/api/admin/immich/mirror-test',
        headers: authHeader(admin),
        payload: { serverUrl: 'http://attacker.test' },
      })
      expect(elsewhere.json()).toEqual({ ok: false, error: 'unauthorized' })
    })

    it('the write key is redacted and dropped when the Immich URL changes', async () => {
      const admin = await createUser({ isAdmin: true })
      const get = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: authHeader(admin) })
      expect(get.json()).toMatchObject({ immichMirrorApiKey: '', immichMirrorApiKeySet: true })

      await app.inject({
        method: 'PATCH',
        url: '/api/admin/settings',
        headers: authHeader(admin),
        payload: { immichServerUrl: 'http://attacker.test' },
      })
      const after = await prisma.setting.findUnique({ where: { key: 'immichMirrorApiKey' } })
      expect(after?.value ?? '').toBe('')
    })
  })
})
