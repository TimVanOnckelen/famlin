import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Upload } from '@prisma/client'
import { prisma } from '../db.js'
import { getStorage } from './storage/registry.js'
import { uploadSourceKey, withStorageObject } from './uploadSources.js'
import { ORIGINAL_EXTENSIONS } from './uploads.js'
import { recordJobRun, sanitizeJobError } from './jobRuns.js'
import { getImmichSettings } from './settings.js'
import { MediaProviderError } from './media/types.js'
import {
  addImmichAlbumAssets,
  immichAlbumExists,
  isFamlinImmichAsset,
  listImmichAlbumAssetIds,
  pingImmich,
  removeImmichAlbumAssets,
  uploadImmichAsset,
} from './media/immichMirror.js'

// Famlin -> Immich upload mirror (issue #420). Opt-in per family via a
// MediaMirrorTarget row. This is state reconciliation, not event hooks:
// every run works out which uploads *should* be in each mirror album right
// now and compares that with the MediaMirror rows, adding what's missing and
// removing what Famlin added that no longer qualifies. One code path covers
// new posts, edits, deletes, cross-posts, backfill, pausing and switching
// albums.
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

// Every /uploads/<uuid> referenced anywhere in a value — a URL, a string
// array, or a JSON column (typeData, comment metadata, wiki Markdown).
export function uploadKeysIn(value: unknown): string[] {
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

type TargetScope = { groupId: string; mirrorSince: Date; enabled: boolean }
type MirrorUpload = Upload & { motionUpload: Upload | null }

// The uploads that belong in an album mirrored for `targets`: original
// photos/videos of whole-family posts in those groups, plus album photos and
// trip check-in photos (stored as comments on such posts), created at or
// after the target's mirrorSince. Ordinary comment attachments, chat, wiki
// images, server-side copies of linked-album assets and the linked-album
// assets themselves (media-proxy URLs, already in a provider) never qualify.
// `enabled`: used by a family whose mirroring is on — only those are added;
// the rest (paused families) are merely kept.
export async function qualifyingUploads(
  targets: TargetScope[],
  privateKeys: Set<string>
): Promise<Map<string, { upload: MirrorUpload; enabled: boolean }>> {
  const result = new Map<string, { upload: MirrorUpload; enabled: boolean }>()
  if (targets.length === 0) return result
  const byGroup = new Map(targets.map((t) => [t.groupId, t]))
  const earliest = new Date(Math.min(...targets.map((t) => t.mirrorSince.getTime())))
  const familyPost = { groupId: { in: [...byGroup.keys()] }, circleId: null, type: { not: 'GIFT_LIST' } }

  const [posts, comments] = await Promise.all([
    prisma.post.findMany({
      where: { ...familyPost, createdAt: { gte: earliest } },
      select: { groupId: true, createdAt: true, uploadedAssetUrls: true },
    }),
    prisma.comment.findMany({
      where: {
        post: familyPost,
        createdAt: { gte: earliest },
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
    const target = byGroup.get(groupId)
    if (!target || createdAt < target.mirrorSince || !Array.isArray(urls)) return
    const local = urls.filter((url): url is string => typeof url === 'string' && url.startsWith('/uploads/'))
    for (const key of uploadKeysIn(local)) candidates.set(key, (candidates.get(key) ?? new Set()).add(groupId))
  }
  for (const post of posts) consider(post.groupId, post.createdAt, post.uploadedAssetUrls)
  for (const comment of comments) {
    consider(comment.post.groupId, comment.createdAt, (comment.metadata as { photoUrls?: unknown } | null)?.photoUrls)
  }
  if (candidates.size === 0) return result

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
    include: { motionUpload: true },
  })
  for (const row of rows) {
    // A Live Photo waits until its video half is processed, so the pair goes
    // up together.
    if (row.motionUpload && ['queued', 'processing'].includes(row.motionUpload.processingStatus)) continue
    // The upload's own audience must cover the family it's mirrored for —
    // a legacy row with no groups is skipped rather than guessed at.
    const groups = [...(candidates.get(row.assetKey) ?? [])].filter((g) => row.groupIds.includes(g))
    if (groups.length === 0) continue
    result.set(row.assetKey, { upload: row, enabled: groups.some((g) => byGroup.get(g)!.enabled) })
  }
  return result
}

// The untouched original, never the 1920px display copy. New uploads keep
// it at originals/<uuid>/<name>; older ones at originals/<uuid>.<ext>; a
// file that was never processed (a GIF) is its own original.
function originalCandidates(upload: Upload): { key: string; filename: string }[] {
  if (upload.sourceFilename) {
    return [{ key: uploadSourceKey(upload.sourceFilename), filename: path.posix.basename(upload.sourceFilename) }]
  }
  const served = upload.mediaUrl ? [path.posix.basename(upload.mediaUrl)] : []
  return [...ORIGINAL_EXTENSIONS.map((ext) => `originals/${upload.assetKey}${ext}`), ...served].map((key) => ({
    key,
    filename: path.posix.basename(key),
  }))
}

const deviceAssetIdFor = (upload: Upload) => `famlin-${upload.assetKey}`

async function sha1File(filePath: string): Promise<string> {
  const hash = createHash('sha1')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

// Copies the original out of storage (local disk or S3) into a temp file and
// uploads it.
async function uploadOriginal(upload: Upload, extra: { livePhotoVideoId?: string; hidden?: boolean } = {}) {
  for (const candidate of originalCandidates(upload)) {
    if (!(await getStorage().stat(candidate.key))) continue
    return withStorageObject(candidate.key, async (filePath) =>
      uploadImmichAsset({
        filePath,
        filename: candidate.filename,
        checksum: await sha1File(filePath),
        deviceAssetId: deviceAssetIdFor(upload),
        fileCreatedAt: upload.createdAt,
        ...extra,
      })
    )
  }
  throw new Error('Original file not found in storage')
}

export interface AlbumSyncResult {
  uploaded: number
  removed: number
  failed: number
}

type MirrorRow = { addedByFamlin: boolean } | undefined

async function mirrorOne(albumId: string, upload: MirrorUpload, row: MirrorRow, inAlbum: Set<string>) {
  const where = {
    provider_externalAlbumId_assetKey: {
      provider: MIRROR_PROVIDER,
      externalAlbumId: albumId,
      assetKey: upload.assetKey,
    },
  }
  await prisma.mediaMirror.upsert({
    where,
    create: { provider: MIRROR_PROVIDER, externalAlbumId: albumId, assetKey: upload.assetKey },
    update: {},
  })
  try {
    // A Live Photo's video half goes up first (hidden), then the still,
    // linked to it — the same pairing Immich's own mobile app makes.
    const motion = upload.motionUpload?.processingStatus === 'ready' ? upload.motionUpload : null
    const livePhotoVideoId = motion ? (await uploadOriginal(motion, { hidden: true })).id : undefined
    const { id, created } = await uploadOriginal(upload, { livePhotoVideoId })
    // Ownership is decided from evidence and written before the album add,
    // so a lost response or a crash can't make Famlin forget an asset it
    // added: a new asset, or one the album didn't hold yet, is Famlin's; one
    // already there is Famlin's only if Famlin's own upload created it.
    const ours =
      !!row?.addedByFamlin ||
      created ||
      !inAlbum.has(id) ||
      (await isFamlinImmichAsset(id, deviceAssetIdFor(upload))) === true
    // The id is recorded before the add too, so the loop guard
    // (mirroredAssetIds) knows the asset if the newAssets job runs meanwhile.
    await prisma.mediaMirror.update({ where, data: { externalAssetId: id, addedByFamlin: ours } })
    const outcome = (await addImmichAlbumAssets(albumId, [id])).get(id)
    if (outcome !== 'added' && outcome !== 'present') throw new Error(`Immich refused the album add (${outcome})`)
    await prisma.mediaMirror.update({ where, data: { status: 'mirrored', lastError: null, attempts: 0 } })
    return true
  } catch (err) {
    if (err instanceof MediaProviderError) {
      // The key rejected, the album gone, or Immich down altogether: a
      // problem with the whole album, not this file — stop the album's run
      // without spending one of this upload's attempts. A connection lost
      // while Immich still answers (a proxy resetting a large video) is
      // this file's problem.
      const fileProblem = err.code === 'request_failed' || (err.code === 'unreachable' && (await pingImmich()))
      if (!fileProblem) throw err
    }
    await prisma.mediaMirror.update({
      where,
      data: { status: 'failed', lastError: sanitizeJobError(err), attempts: { increment: 1 } },
    })
    return false
  }
}

// Reconciles one album against every target that mirrors into it — none
// left (the family switched albums) means everything Famlin added comes out.
export async function syncMirrorAlbum(
  albumId: string,
  targets: TargetScope[],
  privateKeys: Set<string>,
  budget: { uploads: number } = { uploads: MAX_UPLOADS_PER_RUN }
): Promise<AlbumSyncResult> {
  const result: AlbumSyncResult = { uploaded: 0, removed: 0, failed: 0 }
  const [wanted, rows] = await Promise.all([
    qualifyingUploads(targets, privateKeys),
    prisma.mediaMirror.findMany({ where: { provider: MIRROR_PROVIDER, externalAlbumId: albumId } }),
  ])

  // Stale: the post was deleted, the photo edited out, the upload became
  // private, or no family mirrors here any more. Famlin only removes what
  // it added (always asking Immich, rather than trusting the album listing);
  // a row for an asset the album already held is just forgotten. This runs
  // while mirroring is paused too.
  const stale = rows.filter((row) => !wanted.has(row.assetKey))
  if (stale.length > 0) {
    const ours = stale.filter((row) => row.addedByFamlin && row.externalAssetId).map((row) => row.externalAssetId!)
    try {
      await removeImmichAlbumAssets(albumId, [...new Set(ours)])
    } catch (err) {
      // An album deleted in Immich has nothing left to remove.
      const gone =
        err instanceof MediaProviderError && err.code === 'request_failed' && !(await immichAlbumExists(albumId))
      if (!gone) throw err
    }
    await prisma.mediaMirror.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } })
    result.removed = ours.length
  }

  const toAdd = [...wanted].filter(([, entry]) => entry.enabled)
  if (toAdd.length === 0) return result

  const inAlbum = await listImmichAlbumAssetIds(albumId)
  const rowByKey = new Map(rows.map((row) => [row.assetKey, row]))
  // A mirrored asset the listing doesn't show is confirmed by adding it back:
  // the listing can miss other owners' assets, an asset removed by hand is
  // put back, and an id this Immich doesn't know (a restore onto another
  // server) is uploaded again.
  const unconfirmed = toAdd
    .map(([key]) => rowByKey.get(key))
    .filter((row) => row?.status === 'mirrored' && row.externalAssetId && !inAlbum.has(row.externalAssetId))
    .map((row) => row!.externalAssetId!)
  const confirmed = await addImmichAlbumAssets(albumId, unconfirmed)

  for (const [assetKey, { upload }] of toAdd) {
    const row = rowByKey.get(assetKey)
    if (row?.status === 'mirrored' && row.externalAssetId) {
      const outcome = inAlbum.has(row.externalAssetId) ? 'present' : confirmed.get(row.externalAssetId)
      if (outcome === 'present' || outcome === 'added') continue
    }
    if (row?.status === 'failed' && row.attempts >= MAX_MIRROR_ATTEMPTS) {
      result.failed++
      continue
    }
    if (budget.uploads <= 0) break
    budget.uploads--
    if (await mirrorOne(albumId, upload, row, inAlbum)) result.uploaded++
    else result.failed++
  }
  return result
}

export interface MirrorRunResult extends AlbumSyncResult {
  albums: number
}

let running = false
export const isMirrorRunning = () => running

// The scheduled job. Never touches a request path, so Immich being down
// can't block or fail a post; it just fails this run, visibly, in the admin
// status panel.
export async function runMediaMirrorJob(): Promise<MirrorRunResult> {
  const total: MirrorRunResult = { albums: 0, uploaded: 0, removed: 0, failed: 0 }
  // No write key (never set, or dropped by a restore): nothing to do, and
  // the admin's mirror section says so.
  if (running || !(await getImmichSettings('mirror')).configured) return total
  running = true
  try {
    const [targets, rowAlbums] = await Promise.all([
      prisma.mediaMirrorTarget.findMany({ where: { provider: MIRROR_PROVIDER } }),
      prisma.mediaMirror.groupBy({ by: ['externalAlbumId'], where: { provider: MIRROR_PROVIDER } }),
    ])
    // Every album a family mirrors into, plus albums Famlin still has rows
    // for that no family uses any more (switched away from) — those get
    // emptied of what Famlin added.
    const albums = new Map<string, typeof targets>(rowAlbums.map((row) => [row.externalAlbumId, []]))
    for (const target of targets)
      albums.set(target.externalAlbumId, [...(albums.get(target.externalAlbumId) ?? []), target])
    if (albums.size === 0) return total

    const privateKeys = await privateUploadKeys()
    const errors: string[] = []
    const budget = { uploads: MAX_UPLOADS_PER_RUN }
    for (const [albumId, albumTargets] of albums) {
      total.albums++
      try {
        const result = await syncMirrorAlbum(albumId, albumTargets, privateKeys, budget)
        total.uploaded += result.uploaded
        total.removed += result.removed
        total.failed += result.failed
        await prisma.mediaMirrorTarget.updateMany({
          where: { id: { in: albumTargets.map((t) => t.id) } },
          data: { lastSyncedAt: new Date() },
        })
      } catch (err) {
        errors.push(`${albumTargets[0]?.albumName ?? albumId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (errors.length > 0) throw new Error(errors.join('; '))
    if (total.failed > 0) throw new Error(`${total.failed} upload(s) could not be mirrored`)
    return total
  } finally {
    running = false
  }
}

// The job as server.ts and the admin "sync now" start it.
export function startMediaMirrorRun(): Promise<MirrorRunResult> {
  return recordJobRun('mediaMirror', runMediaMirrorJob, (result) => ({ ...result }))
}

// An admin's "sync now": failed uploads get a fresh set of attempts.
export async function resetMirrorFailures(albumId: string): Promise<void> {
  await prisma.mediaMirror.updateMany({
    where: { provider: MIRROR_PROVIDER, externalAlbumId: albumId, status: 'failed' },
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
