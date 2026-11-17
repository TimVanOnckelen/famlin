import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Upload } from '@prisma/client'
import { prisma } from '../db.js'
import { getStorage } from './storage/registry.js'
import { uploadSourceKey } from './uploadSources.js'
import { uploadAssetKey } from './uploads.js'
import { sanitizeJobError } from './jobRuns.js'
import {
  addImmichAlbumAssets,
  ImmichMirrorError,
  listImmichAlbumAssetIds,
  removeImmichAlbumAssets,
  uploadImmichAsset,
} from './media/immichMirror.js'

// Famlin -> Immich upload mirror (issue #420). Opt-in per family via a
// MediaMirrorTarget row. This is state reconciliation, not event hooks:
// every run works out which uploads *should* be in each mirror album right
// now and compares that with the MediaMirror rows, adding what's missing and
// removing what Famlin added that no longer qualifies. One code path covers
// new posts, edits, deletes, cross-posts, backfill and re-enabling.
//
// A mirror, never a storage driver: Famlin keeps serving its own files, and
// nothing Immich does (dedup, deletion) affects them.

export const MIRROR_PROVIDER = 'immich'
// A failing upload is retried on later runs up to this many times; after
// that it stays failed until an admin asks for a sync (resetMirrorFailures).
export const MAX_MIRROR_ATTEMPTS = 5
// Bounds one run (a large backfill continues on the next one).
const MAX_UPLOADS_PER_RUN = 200

const UPLOAD_KEY_RE = /\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Every /uploads/<uuid> referenced anywhere in a value — a URL, a string
// array, or a JSON column (typeData, comment metadata, wiki Markdown).
function uploadKeysIn(value: unknown): string[] {
  if (value == null) return []
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return [...text.matchAll(UPLOAD_KEY_RE)].map((m) => m[1].toLowerCase())
}

// Uploads that private content refers to: circle (and therefore gift-list)
// posts and everything attached to them, stories, gift-list wishes and
// circle wiki pages. Privacy fails closed: one private reference keeps an
// upload out of Immich, even when a family-wide post also uses it — a file
// in a shared Immich album is readable by everyone that album is shared
// with, which would bypass circle privacy entirely.
export async function privateUploadKeys(): Promise<Set<string>> {
  const [circlePosts, circleComments, stories, wishes, wikiPages] = await Promise.all([
    prisma.post.findMany({ where: { circleId: { not: null } }, select: { uploadedAssetUrls: true, typeData: true } }),
    prisma.comment.findMany({
      where: { post: { circleId: { not: null } } },
      select: { attachmentUrl: true, attachmentUrls: true, assetUrl: true, metadata: true },
    }),
    prisma.story.findMany({ select: { imageUrl: true } }),
    prisma.giftListItem.findMany({ where: { photoUrl: { not: null } }, select: { photoUrl: true } }),
    prisma.wikiPage.findMany({ where: { circleId: { not: null } }, select: { content: true } }),
  ])
  const keys = new Set<string>()
  const add = (value: unknown) => uploadKeysIn(value).forEach((key) => keys.add(key))
  for (const post of circlePosts) add([post.uploadedAssetUrls, post.typeData])
  for (const comment of circleComments) add(comment)
  for (const story of stories) add(story.imageUrl)
  for (const wish of wishes) add(wish.photoUrl)
  for (const page of wikiPages) add(page.content)
  return keys
}

type TargetScope = { groupId: string; mirrorSince: Date }

// The uploads that belong in an album mirrored for `targets`: original
// photos/videos of whole-family posts in those groups, plus album photos and
// trip check-in photos (stored as comments on such posts), created at or
// after the target's mirrorSince. Ordinary comment attachments, chat, wiki
// images, server-side copies of linked-album assets and the linked-album
// assets themselves (media-proxy URLs, already in a provider) never qualify.
export async function qualifyingUploads(targets: TargetScope[], excluded?: Set<string>): Promise<Map<string, Upload>> {
  if (targets.length === 0) return new Map()
  const sinceByGroup = new Map(targets.map((t) => [t.groupId, t.mirrorSince]))
  const groupIds = [...sinceByGroup.keys()]
  const familyPost = { groupId: { in: groupIds }, circleId: null, type: { not: 'GIFT_LIST' } }

  const [posts, comments] = await Promise.all([
    prisma.post.findMany({
      where: familyPost,
      select: { groupId: true, createdAt: true, uploadedAssetUrls: true },
    }),
    prisma.comment.findMany({
      where: {
        post: familyPost,
        OR: [
          { metadata: { path: ['kind'], equals: 'album_photo' } },
          { metadata: { path: ['kind'], equals: 'trip_checkin' } },
        ],
      },
      select: { createdAt: true, metadata: true, post: { select: { groupId: true } } },
    }),
  ])

  // assetKey -> the groups whose qualifying content uses it.
  const candidates = new Map<string, Set<string>>()
  const consider = (groupId: string, createdAt: Date, urls: unknown) => {
    const since = sinceByGroup.get(groupId)
    if (!since || createdAt < since || !Array.isArray(urls)) return
    for (const url of urls) {
      if (typeof url !== 'string' || !url.startsWith('/uploads/')) continue
      const key = uploadAssetKey(url).toLowerCase()
      if (!UUID_RE.test(key)) continue
      const groups = candidates.get(key) ?? new Set<string>()
      groups.add(groupId)
      candidates.set(key, groups)
    }
  }
  for (const post of posts) consider(post.groupId, post.createdAt, post.uploadedAssetUrls)
  for (const comment of comments) {
    consider(comment.post.groupId, comment.createdAt, (comment.metadata as { photoUrls?: unknown } | null)?.photoUrls)
  }
  if (candidates.size === 0) return new Map()

  const privateKeys = excluded ?? (await privateUploadKeys())
  const rows = await prisma.upload.findMany({
    where: {
      assetKey: { in: [...candidates.keys()].filter((key) => !privateKeys.has(key)) },
      bound: true,
      serverWide: false,
      circleId: null,
      processingStatus: 'ready',
      // Every file POST /api/uploads writes records its served URL; server
      // copies of linked-album assets (recordServerCopy) never do — they're
      // already in a provider and must not be uploaded back.
      mediaUrl: { not: null },
    },
  })
  const result = new Map<string, Upload>()
  for (const row of rows) {
    // The upload's own audience must cover the family it's mirrored for —
    // a legacy row with no groups is skipped rather than guessed at.
    if (![...(candidates.get(row.assetKey) ?? [])].some((g) => row.groupIds.includes(g))) continue
    result.set(row.assetKey, row)
  }
  return result
}

// Every extension routes/uploads.ts can have written an original under.
const ORIGINAL_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.heic',
  '.heif',
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
]

// The untouched original, never the 1920px display copy. New uploads keep
// it at originals/<uuid>/<name>; older ones at originals/<uuid>.<ext>; a
// file that was never processed (a GIF) is its own original.
function originalCandidates(upload: Upload): { key: string; filename: string }[] {
  const served = upload.mediaUrl ? path.posix.basename(upload.mediaUrl) : null
  if (upload.sourceFilename) {
    return [{ key: uploadSourceKey(upload.sourceFilename), filename: path.posix.basename(upload.sourceFilename) }]
  }
  return [
    ...ORIGINAL_EXTENSIONS.map((ext) => ({
      key: `originals/${upload.assetKey}${ext}`,
      filename: `${upload.assetKey}${ext}`,
    })),
    ...(served ? [{ key: served, filename: served }] : []),
  ]
}

// Copies the original out of storage (local disk or S3) into a temp file,
// hashing it on the way, then uploads it.
async function uploadOriginal(
  upload: Upload,
  extra: { livePhotoVideoId?: string; hidden?: boolean } = {}
): Promise<{ id: string }> {
  const storage = getStorage()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'famlin-mirror-'))
  try {
    for (const candidate of originalCandidates(upload)) {
      const object = await storage.get(candidate.key)
      if (!object) continue
      const filePath = path.join(directory, 'original')
      const hash = createHash('sha1')
      try {
        await pipeline(
          object.stream,
          new Transform({
            transform(chunk, _encoding, done) {
              hash.update(chunk)
              done(null, chunk)
            },
          }),
          createWriteStream(filePath)
        )
      } finally {
        object.stream.destroy()
      }
      return await uploadImmichAsset({
        filePath,
        filename: candidate.filename,
        checksum: hash.digest('hex'),
        deviceAssetId: `famlin-${upload.assetKey}`,
        fileCreatedAt: upload.createdAt,
        ...extra,
      })
    }
    throw new Error('Original file not found in storage')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

export interface AlbumSyncResult {
  uploaded: number
  removed: number
  failed: number
}

async function mirrorOne(
  provider: string,
  albumId: string,
  upload: Upload,
  existing: { addedByFamlin: boolean; attempts: number } | undefined
): Promise<boolean> {
  const where = { provider_externalAlbumId_assetKey: { provider, externalAlbumId: albumId, assetKey: upload.assetKey } }
  await prisma.mediaMirror.upsert({
    where,
    create: { provider, externalAlbumId: albumId, assetKey: upload.assetKey },
    update: {},
  })
  try {
    // A Live Photo's video half goes up first (hidden), then the still,
    // linked to it — the same pairing Immich's own mobile app makes.
    const motion = upload.motionAssetKey
      ? await prisma.upload.findUnique({ where: { assetKey: upload.motionAssetKey } })
      : null
    const livePhotoVideoId =
      motion && motion.processingStatus === 'ready' ? (await uploadOriginal(motion, { hidden: true })).id : undefined
    const { id } = await uploadOriginal(upload, { livePhotoVideoId })
    // Recorded before the album add, so the loop guard (mirroredAssetIds)
    // already knows this asset if the newAssets job runs in between.
    await prisma.mediaMirror.update({ where, data: { externalAssetId: id } })
    const outcome = (await addImmichAlbumAssets(albumId, [id])).get(id) ?? 'failed'
    if (outcome === 'missing' || outcome === 'failed') throw new Error(`Immich refused the album add (${outcome})`)
    await prisma.mediaMirror.update({
      where,
      data: {
        status: 'mirrored',
        lastError: null,
        attempts: 0,
        // 'present' after an earlier Famlin add (a retry, a re-add after a
        // restore) is still Famlin's.
        addedByFamlin: outcome === 'added' || !!existing?.addedByFamlin,
      },
    })
    return true
  } catch (err) {
    // Immich unreachable, the key rejected, the album gone: a problem with
    // the whole album, not this file — stop the album's run without
    // spending one of this upload's attempts.
    if (err instanceof ImmichMirrorError && err.code !== 'request_failed') throw err
    await prisma.mediaMirror.update({
      where,
      data: { status: 'failed', lastError: sanitizeJobError(err), attempts: { increment: 1 } },
    })
    return false
  }
}

// Reconciles one album against every target that mirrors into it.
export async function syncMirrorAlbum(
  provider: string,
  albumId: string,
  targets: (TargetScope & { enabled: boolean })[],
  budget: { uploads: number } = { uploads: MAX_UPLOADS_PER_RUN }
): Promise<AlbumSyncResult> {
  const result: AlbumSyncResult = { uploaded: 0, removed: 0, failed: 0 }
  const enabled = targets.filter((t) => t.enabled)
  // Mirroring turned off everywhere for this album: syncing stops, and the
  // album keeps whatever it holds.
  if (enabled.length === 0) return result

  const privateKeys = await privateUploadKeys()
  // Removal is judged against every target, enabled or not: turning one
  // family's mirroring off must not pull its photos back out of a shared
  // album. Additions only come from enabled targets.
  const [wantedAnywhere, wanted, rows, inAlbum] = await Promise.all([
    qualifyingUploads(targets, privateKeys),
    qualifyingUploads(enabled, privateKeys),
    prisma.mediaMirror.findMany({ where: { provider, externalAlbumId: albumId } }),
    listImmichAlbumAssetIds(albumId),
  ])
  const rowByKey = new Map(rows.map((row) => [row.assetKey, row]))

  // Stale: the post was deleted, the photo edited out, or the upload became
  // private. Famlin only removes what it added; a row for an asset that was
  // already in the album is just forgotten.
  const stale = rows.filter((row) => !wantedAnywhere.has(row.assetKey))
  const toRemove = stale
    .filter((row) => row.addedByFamlin && row.externalAssetId && inAlbum.has(row.externalAssetId))
    .map((row) => row.externalAssetId!)
  await removeImmichAlbumAssets(albumId, [...new Set(toRemove)])
  if (stale.length > 0) await prisma.mediaMirror.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
  result.removed = toRemove.length

  for (const [assetKey, upload] of wanted) {
    const row = rowByKey.get(assetKey)
    // Mirrored and still in the album: nothing to do. An asset Immich no
    // longer has in this album (removed by hand, or ids from another server
    // after a restore) is treated as not mirrored and uploaded again —
    // Immich's checksum dedupe makes that cheap when the file is still there.
    if (row?.status === 'mirrored' && row.externalAssetId && inAlbum.has(row.externalAssetId)) continue
    if (row?.status === 'failed' && row.attempts >= MAX_MIRROR_ATTEMPTS) {
      result.failed++
      continue
    }
    if (budget.uploads <= 0) break
    budget.uploads--
    if (await mirrorOne(provider, albumId, upload, row)) result.uploaded++
    else result.failed++
  }
  return result
}

export interface MirrorRunResult extends AlbumSyncResult {
  albums: number
}

let running = false

// The scheduled job (server.ts, recorded as 'mediaMirror'). Never touches a
// request path, so Immich being down can't block or fail a post; it just
// fails this run, visibly, in the admin status panel.
export async function runMediaMirrorJob(): Promise<MirrorRunResult> {
  const total: MirrorRunResult = { albums: 0, uploaded: 0, removed: 0, failed: 0 }
  if (running) return total
  running = true
  try {
    const targets = await prisma.mediaMirrorTarget.findMany()
    const albums = new Map<string, typeof targets>()
    for (const target of targets) {
      const key = `${target.provider}\u0000${target.externalAlbumId}`
      albums.set(key, [...(albums.get(key) ?? []), target])
    }
    const errors: string[] = []
    const budget = { uploads: MAX_UPLOADS_PER_RUN }
    for (const group of albums.values()) {
      const { provider, externalAlbumId } = group[0]
      if (provider !== MIRROR_PROVIDER || !group.some((t) => t.enabled)) continue
      total.albums++
      try {
        const result = await syncMirrorAlbum(provider, externalAlbumId, group, budget)
        total.uploaded += result.uploaded
        total.removed += result.removed
        total.failed += result.failed
        await prisma.mediaMirrorTarget.updateMany({
          where: { id: { in: group.map((t) => t.id) } },
          data: { lastSyncedAt: new Date() },
        })
      } catch (err) {
        errors.push(`${group.map((t) => t.albumName)[0]}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (errors.length > 0) throw new Error(errors.join('; '))
    if (total.failed > 0) throw new Error(`${total.failed} upload(s) could not be mirrored`)
    return total
  } finally {
    running = false
  }
}

// An admin's "sync now": failed uploads get a fresh set of attempts.
export async function resetMirrorFailures(provider: string, albumId: string): Promise<void> {
  await prisma.mediaMirror.updateMany({
    where: { provider, externalAlbumId: albumId, status: 'failed' },
    data: { attempts: 0 },
  })
}

// Loop guard: provider asset ids Famlin uploaded into this album. The
// newAssets job and the photo timeline skip them, or AUTO mode would turn
// every mirrored photo into a new post and the Photos tab would show each
// one twice (once from the post, once from the album).
export async function mirroredAssetIds(provider: string, externalAlbumId: string): Promise<Set<string>> {
  const rows = await prisma.mediaMirror.findMany({
    where: { provider, externalAlbumId, externalAssetId: { not: null } },
    select: { externalAssetId: true },
  })
  return new Set(rows.map((row) => row.externalAssetId!))
}
