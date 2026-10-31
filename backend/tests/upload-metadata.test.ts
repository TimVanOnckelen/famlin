import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { prisma } from '../src/db.js'
import { attachUploadProcessing } from '../src/services/uploadMetadata.js'
import { buildTestApp, createUser, createGroupWithMember, createPost, authHeader } from './helpers.js'

vi.mock('../src/services/uploadProcessing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/uploadProcessing.js')>()),
  startUploadWorker: () => async () => {},
}))

let app: FastifyInstance
beforeAll(async () => {
  app = await buildTestApp()
})
afterAll(async () => {
  await app.close()
})

it('batches metadata for feed media and returns the same state in post detail', async () => {
  const user = await createUser()
  const group = await createGroupWithMember(user)
  const photoKey = randomUUID(),
    motionKey = randomUUID(),
    queuedKey = randomUUID(),
    legacyKey = randomUUID()
  const photo = `/uploads/${photoKey}.jpg`,
    motion = `/uploads/${motionKey}.mp4`,
    queued = `/uploads/${queuedKey}.jpg`
  await prisma.upload.createMany({
    data: [
      {
        assetKey: photoKey,
        uploaderId: user.id,
        mediaUrl: photo,
        thumbnailUrl: `/uploads/${photoKey}-thumbnail.jpg`,
        mediaKind: 'livePhoto',
      },
      {
        assetKey: motionKey,
        uploaderId: user.id,
        mediaUrl: motion,
        mediaKind: 'video',
        processingStatus: 'processing',
      },
      { assetKey: queuedKey, uploaderId: user.id, mediaUrl: queued, processingStatus: 'queued' },
    ],
  })
  await prisma.upload.update({ where: { assetKey: photoKey }, data: { motionAssetKey: motionKey } })
  const first = await createPost({ authorId: user.id, groupId: group.id, uploadedAssetUrls: [photo, queued] })
  await createPost({ authorId: user.id, groupId: group.id, uploadedAssetUrls: [`/uploads/${legacyKey}.jpg`] })
  const find = vi.spyOn(prisma.upload, 'findMany')
  const feed = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(user) })
  expect(feed.statusCode).toBe(200)
  expect(find).toHaveBeenCalledTimes(1)
  find.mockRestore()
  const post = feed.json().items.find((item: { id: string }) => item.id === first.id)
  expect(post.uploadProcessing).toEqual({
    [photoKey]: {
      status: 'processing',
      kind: 'livePhoto',
      url: photo,
      thumbnailUrl: `/uploads/${photoKey}-thumbnail.jpg`,
      videoUrl: motion,
    },
    [queuedKey]: { status: 'queued', kind: 'image', url: queued, thumbnailUrl: null, videoUrl: null },
  })
  expect(JSON.stringify(post.uploadProcessing)).not.toContain('sourceFilename')
  const detail = await app.inject({ method: 'GET', url: `/api/posts/${first.id}`, headers: authHeader(user) })
  expect(detail.json().uploadProcessing).toEqual(post.uploadProcessing)
  const legacy = feed.json().items.find((item: { id: string }) => item.id !== first.id)
  expect(legacy.uploadProcessing[legacyKey].status).toBe('ready')
})

it('includes album/trip preview assets in the batch and skips external media', async () => {
  const key = randomUUID()
  const url = `/uploads/${key}.mp4`
  await prisma.upload.create({ data: { assetKey: key, mediaKind: 'video', mediaUrl: url, processingStatus: 'failed' } })
  const rows = await attachUploadProcessing([
    { uploadedAssetUrls: [], typeData: { coverPhotoUrl: url } },
    { uploadedAssetUrls: [], album: { collagePhotoUrls: [url] } },
    { uploadedAssetUrls: [], trip: { collagePhotoUrls: [url] } },
  ])
  for (const row of rows) expect(row.uploadProcessing[key]).toMatchObject({ kind: 'video', status: 'failed' })
  const find = vi.spyOn(prisma.upload, 'findMany')
  expect(await attachUploadProcessing([{ uploadedAssetUrls: ['/api/media/album/photo'] }])).toEqual([
    { uploadedAssetUrls: ['/api/media/album/photo'], uploadProcessing: {} },
  ])
  expect(find).not.toHaveBeenCalled()
  find.mockRestore()
})
