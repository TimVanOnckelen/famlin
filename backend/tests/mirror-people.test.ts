import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '../src/db.js'
import { updateSettings, __resetSettingsCacheForTests } from '../src/services/settings.js'
import { __clearPersonTagCacheForTests } from '../src/services/media/personTags.js'
import { __clearMirrorPeopleCacheForTests } from '../src/services/media/mirrorPeople.js'
import { __clearPhotoTimelineCacheForTests } from '../src/services/media/photoTimeline.js'
import { buildTestApp, createUser, createGroupWithMember, createPost, authHeader } from './helpers.js'

const SERVER = 'http://immich.test'
const READ_KEY = 'read-key'
const MIRROR_KEY = 'mirror-key'

// Just enough Immich for face lookups: the album search with people, single
// assets, the people catalog and person thumbnails. Every request records
// the key it was made with, and albums/people are only visible to `owner`'s
// key — the mirror account owns the mirror albums.
class FakeImmich {
  // albumId -> assetId -> people
  albums = new Map<string, Map<string, Array<{ id: string; name: string }>>>()
  ownPeople = new Map<string, Array<{ id: string; name: string }>>([
    [READ_KEY, []],
    [MIRROR_KEY, []],
  ])
  owner = MIRROR_KEY
  down = false
  requests: Array<{ path: string; key: string }> = []

  async handle(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.down) throw new TypeError('fetch failed')
    const { pathname } = new URL(url)
    const key = (init.headers as Record<string, string>)['x-api-key']
    this.requests.push({ path: pathname, key })
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    let m: RegExpExecArray | null

    if (pathname === '/api/search/metadata') {
      const album = key === this.owner ? this.albums.get(body.albumIds?.[0]) : undefined
      const items = [...(album ?? new Map()).entries()].map(([id, people]) => ({
        id,
        type: 'IMAGE',
        ...(body.withPeople ? { people } : {}),
      }))
      return ok({ assets: { items, nextPage: null } })
    }
    if ((m = /^\/api\/people\/([^/]+)\/thumbnail$/.exec(pathname))) {
      return new Response(Buffer.from(`thumb-${m[1]}`), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }
    if (pathname === '/api/people') return ok({ people: this.ownPeople.get(key) ?? [] })
    return ok({ message: `unexpected ${pathname}` }, 404)
  }
}

let immich: FakeImmich

describe('face tags on mirrored uploads', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await prisma.mediaMirrorTarget.deleteMany()
    await prisma.mediaMirror.deleteMany()
    await prisma.mediaPersonLink.deleteMany()
    __clearPersonTagCacheForTests()
    __clearMirrorPeopleCacheForTests()
    __clearPhotoTimelineCacheForTests()
    immich = new FakeImmich()
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => immich.handle(String(input), init))
    await updateSettings({ immichServerUrl: SERVER, immichApiKey: READ_KEY, immichMirrorApiKey: MIRROR_KEY })
    __resetSettingsCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // A family with a mirror album, and one uploaded photo of theirs that the
  // mirror has copied into it, with `people` on the Immich side.
  async function setup(people: Array<{ id: string; name: string }>, status = 'mirrored') {
    const member = await createUser()
    const group = await createGroupWithMember(member)
    const albumId = randomUUID()
    await prisma.mediaMirrorTarget.create({
      data: { groupId: group.id, externalAlbumId: albumId, albumName: 'Famlin', mirrorSince: new Date(0) },
    })
    const photo = await mirroredUpload(albumId, people, status)
    return { member, group, albumId, photo }
  }

  async function mirroredUpload(albumId: string, people: Array<{ id: string; name: string }>, status = 'mirrored') {
    const assetKey = randomUUID()
    const immichAssetId = randomUUID()
    if (!immich.albums.has(albumId)) immich.albums.set(albumId, new Map())
    immich.albums.get(albumId)!.set(immichAssetId, people)
    await prisma.mediaMirror.create({
      data: {
        provider: 'immich',
        externalAlbumId: albumId,
        assetKey,
        externalAssetId: immichAssetId,
        addedByFamlin: true,
        status,
      },
    })
    return { url: `/uploads/${assetKey}.jpg`, assetKey }
  }

  async function feedPeople(member: Parameters<typeof authHeader>[0], postId: string) {
    const res = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(member) })
    expect(res.statusCode).toBe(200)
    return (res.json().items as Array<{ id: string; people: Array<{ label: string; userId: string | null }> }>).find(
      (p) => p.id === postId
    )!.people
  }

  it('tags a post photo with the mapped people Immich found on its mirrored copy', async () => {
    const emma = await createUser({ name: 'Emma' })
    const { member, group, photo } = await setup([
      { id: 'p-emma', name: 'Emma' },
      { id: 'p-stranger', name: '' },
    ])
    await prisma.mediaPersonLink.create({
      data: { provider: 'immich', externalPersonId: 'p-emma', label: 'Emma', userId: emma.id },
    })
    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })

    expect(await feedPeople(member, post.id)).toEqual([
      { id: 'p-emma', provider: 'immich', label: 'Emma', userId: emma.id, userName: 'Emma', userAvatarUrl: null },
    ])
    // Read with the mirror key: the mirror account owns these assets.
    const searches = immich.requests.filter((r) => r.path === '/api/search/metadata')
    expect(searches.length).toBeGreaterThan(0)
    expect(searches.every((r) => r.key === MIRROR_KEY)).toBe(true)
  })

  it('tags album and trip posts from the photos stored as comments on them', async () => {
    const { member, group, albumId, photo } = await setup([{ id: 'p-emma', name: 'Emma' }])
    const tripPhoto = await mirroredUpload(albumId, [{ id: 'p-opa', name: 'Opa' }])
    await prisma.mediaPersonLink.createMany({
      data: [
        { provider: 'immich', externalPersonId: 'p-emma', label: 'Emma' },
        { provider: 'immich', externalPersonId: 'p-opa', label: 'Opa' },
      ],
    })
    const album = await createPost({ groupId: group.id, authorId: member.id })
    const trip = await createPost({ groupId: group.id, authorId: member.id })
    await prisma.comment.create({
      data: {
        postId: album.id,
        authorId: member.id,
        content: '',
        metadata: { kind: 'album_photo', contributionId: randomUUID(), photoUrls: [photo.url] },
      },
    })
    await prisma.comment.create({
      data: {
        postId: trip.id,
        authorId: member.id,
        content: '',
        metadata: { kind: 'trip_checkin', checkinId: randomUUID(), place: 'Ghent', photoUrls: [tripPhoto.url] },
      },
    })

    expect((await feedPeople(member, album.id)).map((p) => p.label)).toEqual(['Emma'])
    expect((await feedPeople(member, trip.id)).map((p) => p.label)).toEqual(['Opa'])
  })

  it('ignores uploads that are not mirrored yet', async () => {
    const { member, group, photo } = await setup([{ id: 'p-emma', name: 'Emma' }], 'pending')
    await prisma.mediaPersonLink.create({ data: { provider: 'immich', externalPersonId: 'p-emma', label: 'Emma' } })
    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })

    expect(await feedPeople(member, post.id)).toEqual([])
  })

  it('makes no Immich call without a mirror key', async () => {
    const { member, group, photo } = await setup([{ id: 'p-emma', name: 'Emma' }])
    await prisma.mediaPersonLink.create({ data: { provider: 'immich', externalPersonId: 'p-emma', label: 'Emma' } })
    await updateSettings({ immichMirrorApiKey: null })
    __resetSettingsCacheForTests()
    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })

    expect(await feedPeople(member, post.id)).toEqual([])
    expect(immich.requests).toEqual([])
  })

  it('fails soft when Immich is unreachable', async () => {
    const { member, group, photo } = await setup([{ id: 'p-emma', name: 'Emma' }])
    await prisma.mediaPersonLink.create({ data: { provider: 'immich', externalPersonId: 'p-emma', label: 'Emma' } })
    const post = await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url] })
    immich.down = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await feedPeople(member, post.id)).toEqual([])
  })

  it('filters the Photos timeline by person on mirrored uploads, label-aware', async () => {
    const { member, group, albumId, photo } = await setup([{ id: 'p-emma-mirror', name: 'Emma' }])
    const other = await mirroredUpload(albumId, [{ id: 'p-opa', name: 'Opa' }])
    // Emma is mapped twice: once from the read account's library, once from
    // the mirror account's — the filter on either id finds both.
    await prisma.mediaPersonLink.createMany({
      data: [
        { provider: 'immich', externalPersonId: 'p-emma-read', label: 'Emma' },
        { provider: 'immich', externalPersonId: 'p-emma-mirror', label: 'Emma' },
        { provider: 'immich', externalPersonId: 'p-opa', label: 'Opa' },
      ],
    })
    await createPost({ groupId: group.id, authorId: member.id, uploadedAssetUrls: [photo.url, other.url] })

    const res = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos?personId=p-emma-read`,
      headers: authHeader(member),
    })
    expect(res.statusCode).toBe(200)
    expect((res.json().items as Array<{ originalUrl: string }>).map((i) => i.originalUrl)).toEqual([photo.url])

    const unfiltered = await app.inject({
      method: 'GET',
      url: `/api/media/groups/${group.id}/photos`,
      headers: authHeader(member),
    })
    expect(unfiltered.json().items).toHaveLength(2)
  })

  it("lists the mirror albums' people in the admin people picker", async () => {
    const admin = await createUser({ isAdmin: true })
    await setup([
      { id: 'p-emma', name: 'Emma' },
      { id: 'p-own', name: 'Own' },
    ])
    immich.ownPeople.set(READ_KEY, [{ id: 'p-own', name: 'Own' }])

    const res = await app.inject({ method: 'GET', url: '/api/admin/media/immich/people', headers: authHeader(admin) })
    expect(res.statusCode).toBe(200)
    const people = res.json() as Array<{ id: string; name: string; thumbnailDataUri: string | null }>
    expect(people.map((p) => p.id).sort()).toEqual(['p-emma', 'p-own'])
    expect(people.find((p) => p.id === 'p-emma')!.thumbnailDataUri).toBe(
      `data:image/jpeg;base64,${Buffer.from('thumb-p-emma').toString('base64')}`
    )
    const thumb = immich.requests.find((r) => r.path === '/api/people/p-emma/thumbnail')!
    expect(thumb.key).toBe(MIRROR_KEY)
  })
})
