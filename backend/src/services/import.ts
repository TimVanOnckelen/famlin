import { getStorage } from './storage/registry.js'
import { assertValidStorageKey } from './storage/types.js'
// Restores an archive produced by buildExportArchive() (services/export.ts)
// into an EMPTY instance — the inverse of the admin export, used by the
// first-run setup screen's "restore from a backup" path
// (POST /api/auth/setup/restore).
//
// Deliberately restore-only, never merge: the target must have zero users,
// checked under the same advisory lock POST /api/auth/setup takes, so rows
// can be inserted with their ORIGINAL ids. Re-keying would mean rewriting
// every foreign key plus the /uploads/<uuid> paths and /api/media/assets/
// <linkId>/... URLs embedded in posts, comments, chat messages and Json
// typeData/metadata — preserving ids avoids all of that, and is only safe
// because nothing can collide.
//
// Two generations of archive (manifest `format`, see export.ts):
//  - format 2+ ("Famlin backup", issue #461) carries password hashes and the
//    server settings minus credentials, so everyone signs in afterwards with
//    their existing account. No admin account needs creating — `admin` is
//    optional, and if given still sets that person's password.
//  - format 1 (the original data export) carries neither, so a restored
//    instance's members cannot log in until an admin reconfigures SSO or
//    resets their passwords — the person restoring must get an admin login
//    out of the same request (`admin`), which is what makes that possible.
// Neither ever brings back credential settings (OIDC client secret, SMTP
// password, Immich API key), invites, push or API tokens, or notification
// history (export.ts excludes them on purpose).
//
// An archive without its media (a scheduled backup, or a download "without
// media") lists the files it needs in the manifest; those already in storage
// are used as they are, and the rest are copied from the backups volume's
// media mirror (services/backup/mediaRestore.ts).
import { Prisma, ReactionType, NewAssetMode } from '@prisma/client'
import { z } from 'zod'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'
import { prisma } from '../db.js'
import { uploadsDir } from '../config.js'
import { invalidateSettingsCache, RESTORABLE_SETTING_KEYS } from './settings.js'
import { restoreRequiredMedia } from './backup/mediaRestore.js'
import { BACKUP_UPLOADS_DIR } from './backup/paths.js'
import { BRANDING_SETTING_KEYS } from './branding/index.js'
import pkg from '../../package.json' with { type: 'json' }

export type RestoreErrorCode =
  'invalidArchive' | 'archiveTooNew' | 'notEmpty' | 'busy' | 'missingMedia' | 'adminRequired'

export class RestoreError extends Error {
  constructor(
    public readonly code: RestoreErrorCode,
    message?: string,
    public readonly missingKeys?: string[]
  ) {
    super(message ?? code)
    this.name = 'RestoreError'
  }
}

// Restored users get a tokenVersion no real deployment reaches by bumping
// it one password change at a time. Format-1 archives don't carry
// tokenVersion, and resetting everyone to the default 0 would bring back
// every JWT a password reset had revoked, on a server restored with the
// same JWT_SECRET. Starting above any plausible old value invalidates every
// token issued before the restore instead. A format-2 archive's own
// tokenVersion is bumped past (restoredTokenVersion), so sessions issued
// after an earlier restore die too.
export const RESTORED_TOKEN_VERSION = 1_000_000

export function restoredTokenVersion(archived: number | undefined): number {
  return Math.max(RESTORED_TOKEN_VERSION, (archived ?? 0) + 1)
}

// Prefix of the per-request working directory, created INSIDE uploadsDir so
// the final move of each extracted file into place is a same-filesystem
// rename (uploadsDir is usually its own Docker volume), and so a multi-GB
// upload is spooled to the volume sized for media rather than the
// container's /tmp. export.ts skips it.
export const RESTORE_WORKDIR_PREFIX = '.restore-'

// ---------------------------------------------------------------------------
// Archive row schemas. The archive is untrusted input, so every row is
// validated and reduced to the columns Famlin actually has — an unknown key
// is stripped rather than written. Fields
// added to the export after its first version are optional, so an older
// archive restores with those columns at their schema defaults.
// ---------------------------------------------------------------------------

const id = z.string().min(1)
const date = z.coerce.date()
const nullableDate = z.coerce.date().nullable().optional()
const nullableString = z.string().nullable().optional()
const optionalBool = z.boolean().optional()
// Json columns: `null` in the archive means SQL NULL, which Prisma requires
// spelling as Prisma.DbNull.
const nullableJson = z
  .unknown()
  .transform((v) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue)))

const userRow = z.object({
  id,
  email: z.string().min(1),
  name: z.string(),
  avatarUrl: nullableString,
  // Format 2+. A bcrypt hash; anything longer isn't one.
  passwordHash: z.string().max(200).nullable().optional(),
  tokenVersion: z.number().int().nonnegative().optional(),
  isAdmin: z.boolean(),
  createdAt: date,
  emailOnNewPost: optionalBool,
  emailOnNewComment: optionalBool,
  emailOnNewLike: optionalBool,
  pushOnNewPost: optionalBool,
  pushOnNewComment: optionalBool,
  pushOnNewLike: optionalBool,
  pushOnChitchat: optionalBool,
  pushOnStory: optionalBool,
  pushOnGiftList: optionalBool,
})

const groupMemberRow = z.object({ id, groupId: id, userId: id, joinedAt: date })

const groupRow = z.object({
  id,
  name: z.string(),
  description: nullableString,
  allowedPostTypes: z.array(z.string()).optional(),
  chitchatEnabled: optionalBool,
  storiesEnabled: optionalBool,
  createdAt: date,
  members: z.array(groupMemberRow).default([]),
})

const circleMemberRow = z.object({ id, circleId: id, userId: id, joinedAt: date })

const circleRow = z.object({
  id,
  groupId: id,
  name: z.string(),
  description: nullableString,
  avatarUrl: nullableString,
  createdById: nullableString,
  // Absent before gift lists: every older circle is a Family Circle.
  kind: z.string().optional(),
  createdAt: date,
  updatedAt: date,
  members: z.array(circleMemberRow).default([]),
})

const postRow = z.object({
  id,
  authorId: id,
  groupId: id,
  circleId: nullableString,
  content: nullableString,
  type: z.string().optional(),
  typeData: nullableJson,
  milestoneTag: nullableString,
  uploadedAssetUrls: z.array(z.string()).default([]),
  createdAt: date,
  editedAt: nullableDate,
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  locationName: nullableString,
  crossPostId: nullableString,
})

const postInteractionRow = z.object({
  id,
  postId: id,
  userId: id,
  key: z.string(),
  value: z.unknown().transform((v) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue))),
  createdAt: date,
})

const commentRow = z.object({
  id,
  postId: id,
  authorId: id,
  assetUrl: nullableString,
  attachmentUrl: nullableString,
  attachmentUrls: z.array(z.string()).default([]),
  content: z.string(),
  metadata: nullableJson,
  createdAt: date,
  editedAt: nullableDate,
  parentId: nullableString,
})

const reactionRow = z.object({
  id,
  postId: nullableString,
  commentId: nullableString,
  userId: id,
  type: z.enum(ReactionType).optional(),
  createdAt: date,
})

const favoriteRow = z.object({ id, postId: id, userId: id, createdAt: date })

const chatMessageRow = z.object({
  id,
  groupId: id,
  authorId: id,
  kind: z.string().optional(),
  content: nullableString,
  attachmentUrl: nullableString,
  refPostId: nullableString,
  replyToMessageId: nullableString,
  createdAt: date,
  editedAt: nullableDate,
})

const chatReadRow = z.object({ id, groupId: id, userId: id, lastReadAt: date })

const mediaAlbumLinkRow = z.object({
  id,
  groupId: id,
  provider: z.string().optional(),
  externalAlbumId: z.string(),
  albumName: z.string(),
  createdAt: date,
  newAssetMode: z.enum(NewAssetMode).optional(),
  newAssetsCheckedAt: nullableDate,
})

const mediaPersonLinkRow = z.object({
  id,
  provider: z.string(),
  externalPersonId: z.string(),
  label: z.string(),
  userId: nullableString,
  createdAt: date,
})

const uploadRow = z.object({
  id,
  assetKey: z.string().min(1),
  uploaderId: nullableString,
  circleId: nullableString,
  bound: z.boolean(),
  // Absent from archives exported before uploads were group-scoped: such a
  // row restores as a legacy bound row, exactly the state it was in.
  groupIds: z.array(z.string()).default([]),
  serverWide: z.boolean().default(false),
  processingStatus: z.enum(['ready', 'queued', 'processing', 'failed']).optional(),
  sourceFilename: nullableString,
  uploadSessionId: nullableString,
  livePhotoIdentifier: nullableString,
  mediaKind: z.enum(['image', 'video', 'livePhoto']).optional(),
  motionAssetKey: nullableString,
  mediaUrl: nullableString,
  thumbnailUrl: nullableString,
  processingStartedAt: nullableDate,
  processingError: nullableString,
  createdAt: date,
})

const giftListItemRow = z.object({
  id,
  postId: id,
  ownerId: id,
  title: z.string(),
  note: nullableString,
  url: nullableString,
  photoUrl: nullableString,
  position: z.number().int(),
  // Archives from before guest wishlists lack it.
  guestId: nullableString,
  createdAt: date,
  updatedAt: date,
})

const giftListGuestRow = z.object({ id, postId: id, name: z.string(), managedById: id, createdAt: date })

const wikiPageRow = z.object({
  id,
  groupId: id,
  circleId: nullableString,
  title: z.string(),
  emoji: nullableString,
  category: nullableString,
  content: z.string(),
  locked: z.boolean().default(false),
  createdById: nullableString,
  updatedById: nullableString,
  createdAt: date,
  updatedAt: date,
})

const giftDrawAssignmentRow = z.object({ id, postId: id, giverId: id, recipientId: id, createdAt: date })

const storyReactionRow = z.object({ id, userId: id, type: z.enum(ReactionType).optional(), createdAt: date })

// Only pinned stories (Highlights) are ever exported — live stories, views
// and private replies are deliberately left out (see services/export.ts).
// `expiresAt`/`crossStoryId` were added to the export after Highlights first
// shipped in it, hence optional.
const highlightRow = z.object({
  id,
  authorId: id,
  groupId: id,
  circleId: nullableString,
  crossStoryId: nullableString,
  imageUrl: z.string().min(1),
  createdAt: date,
  expiresAt: nullableDate,
  pinnedAt: date,
  reactions: z.array(storyReactionRow).default([]),
})

// Only the branding Setting keys are accepted — an archive can never write
// credentials or other server config through this file.
const brandingRow = z.object({
  key: z.enum(BRANDING_SETTING_KEYS),
  value: z.string().max(200),
})

// Server settings (format 2+): only keys a backup may carry — never a
// credential, whatever the archive says.
const settingRow = z.object({
  key: z.enum(RESTORABLE_SETTING_KEYS as [string, ...string[]]),
  value: z.string().max(100_000),
})

const manifestSchema = z.object({
  serverVersion: z.string(),
  format: z.number().int().positive().default(1),
  credentials: z.boolean().default(false),
  includeMedia: z.boolean().default(true),
  mediaLocation: z.enum(['archive', 'storage', 'mirror']).optional(),
  exportedAt: z.string().optional(),
  requiredMedia: z.array(z.object({ key: z.string(), size: z.number().int().nonnegative() })).default([]),
})

// Archive file → schema. Files missing from an archive (one exported before
// that table was added) restore as empty; manifest, users and groups are
// required, since an archive without them isn't a Famlin export at all.
const DATA_FILES = {
  users: { file: 'data/users.json', schema: z.array(userRow), required: true },
  groups: { file: 'data/groups.json', schema: z.array(groupRow), required: true },
  circles: { file: 'data/circles.json', schema: z.array(circleRow), required: false },
  posts: { file: 'data/posts.json', schema: z.array(postRow), required: false },
  postInteractions: { file: 'data/post-interactions.json', schema: z.array(postInteractionRow), required: false },
  comments: { file: 'data/comments.json', schema: z.array(commentRow), required: false },
  reactions: { file: 'data/reactions.json', schema: z.array(reactionRow), required: false },
  favorites: { file: 'data/favorites.json', schema: z.array(favoriteRow), required: false },
  chatMessages: { file: 'data/chat-messages.json', schema: z.array(chatMessageRow), required: false },
  chatReads: { file: 'data/chat-reads.json', schema: z.array(chatReadRow), required: false },
  mediaAlbumLinks: { file: 'data/media-album-links.json', schema: z.array(mediaAlbumLinkRow), required: false },
  mediaPersonLinks: { file: 'data/media-person-links.json', schema: z.array(mediaPersonLinkRow), required: false },
  uploads: { file: 'data/uploads.json', schema: z.array(uploadRow), required: false },
  highlights: { file: 'data/highlights.json', schema: z.array(highlightRow), required: false },
  branding: { file: 'data/branding.json', schema: z.array(brandingRow), required: false },
  settings: { file: 'data/settings.json', schema: z.array(settingRow), required: false },
  giftListGuests: { file: 'data/gift-list-guests.json', schema: z.array(giftListGuestRow), required: false },
  giftListItems: { file: 'data/gift-list-items.json', schema: z.array(giftListItemRow), required: false },
  giftDrawAssignments: {
    file: 'data/gift-draw-assignments.json',
    schema: z.array(giftDrawAssignmentRow),
    required: false,
  },
  wikiPages: { file: 'data/wiki-pages.json', schema: z.array(wikiPageRow), required: false },
} as const

type DataKey = keyof typeof DATA_FILES
type ArchiveData = { [K in DataKey]: z.output<(typeof DATA_FILES)[K]['schema']> }
export type RestoreCounts = Record<DataKey | 'groupMembers' | 'circleMembers' | 'files' | 'mirroredFiles', number>
export type ArchiveManifest = z.output<typeof manifestSchema>

// A single JSON entry is held in memory to parse it; anything this large is
// not an export from a family server.
const MAX_JSON_ENTRY_BYTES = 1024 * 1024 * 1024

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

function parseVersion(v: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

// True when `archiveVersion` is newer than `serverVersion` — such an archive
// may carry columns/semantics this server's schema doesn't have yet.
export function isNewerVersion(archiveVersion: string, serverVersion: string): boolean {
  const a = parseVersion(archiveVersion)
  const s = parseVersion(serverVersion)
  if (!a || !s) throw new RestoreError('invalidArchive', `unparseable version: ${archiveVersion}`)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== s[i]) return a[i] > s[i]
  }
  return false
}

// ---------------------------------------------------------------------------
// Zip reading
// ---------------------------------------------------------------------------

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) reject(new RestoreError('invalidArchive', err?.message))
      else resolve(zip)
    })
  })
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error('no stream'))
      else resolve(stream)
    })
  })
}

async function readEntryText(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  if (entry.uncompressedSize > MAX_JSON_ENTRY_BYTES) {
    throw new RestoreError('invalidArchive', `${entry.fileName} is too large`)
  }
  const stream = await openEntryStream(zip, entry)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function isSymlink(entry: yauzl.Entry): boolean {
  // Unix mode lives in the high 16 bits of the external attributes.
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
}

interface ReadArchiveResult {
  manifest: z.output<typeof manifestSchema>
  rawData: Partial<Record<DataKey, unknown>>
  fileCount: number
}

// Walks the archive once: JSON entries are parsed in memory, every
// uploads/** file is streamed to `filesDir` (never straight into
// uploadsDir — nothing touches the live media directory until the database
// half has committed). yauzl itself rejects absolute paths and `..`
// segments; the resolved-path check below is the belt to that brace.
async function readArchive(zipPath: string, filesDir: string): Promise<ReadArchiveResult> {
  const zip = await openZip(zipPath)
  const jsonByName = new Map<string, string>()
  const wantedJson = new Set<string>(['manifest.json', ...Object.values(DATA_FILES).map((d) => d.file)])
  let fileCount = 0

  await new Promise<void>((resolve, reject) => {
    const fail = (err: unknown) => {
      zip.close()
      reject(err instanceof RestoreError ? err : new RestoreError('invalidArchive', (err as Error)?.message))
    }

    zip.on('error', fail)
    zip.on('end', () => resolve())
    zip.on('entry', (entry: yauzl.Entry) => {
      ;(async () => {
        const name = entry.fileName
        if (name.endsWith('/') || isSymlink(entry)) return

        if (wantedJson.has(name)) {
          jsonByName.set(name, await readEntryText(zip, entry))
          return
        }

        if (name.startsWith('uploads/')) {
          const rel = name.slice('uploads/'.length)
          if (!rel || rel.startsWith(RESTORE_WORKDIR_PREFIX)) return
          try {
            assertValidStorageKey(rel)
          } catch {
            throw new RestoreError('invalidArchive', `unsafe path: ${name}`)
          }
          const target = path.resolve(filesDir, rel)
          if (!target.startsWith(filesDir + path.sep)) {
            throw new RestoreError('invalidArchive', `unsafe path: ${name}`)
          }
          await fsp.mkdir(path.dirname(target), { recursive: true })
          await pipeline(await openEntryStream(zip, entry), fs.createWriteStream(target))
          fileCount += 1
        }
        // Anything else in the zip is ignored.
      })().then(() => zip.readEntry(), fail)
    })
    zip.readEntry()
  })

  const parseJson = (name: string): unknown => {
    try {
      return JSON.parse(jsonByName.get(name)!)
    } catch {
      throw new RestoreError('invalidArchive', `${name} is not valid JSON`)
    }
  }

  if (!jsonByName.has('manifest.json')) throw new RestoreError('invalidArchive', 'missing manifest.json')
  const manifest = manifestSchema.safeParse(parseJson('manifest.json'))
  if (!manifest.success) throw new RestoreError('invalidArchive', 'invalid manifest.json')

  const rawData: Partial<Record<DataKey, unknown>> = {}
  for (const [key, spec] of Object.entries(DATA_FILES) as [DataKey, (typeof DATA_FILES)[DataKey]][]) {
    if (jsonByName.has(spec.file)) rawData[key] = parseJson(spec.file)
    else if (spec.required) throw new RestoreError('invalidArchive', `missing ${spec.file}`)
  }

  return { manifest: manifest.data, rawData, fileCount }
}

// Just the manifest, for listing backups in the volume (services/backup/archive.ts).
export async function readArchiveManifest(zipPath: string): Promise<ArchiveManifest> {
  const zip = await openZip(zipPath)
  try {
    const text = await new Promise<string>((resolve, reject) => {
      zip.on('error', (err) => reject(new RestoreError('invalidArchive', (err as Error).message)))
      zip.on('end', () => reject(new RestoreError('invalidArchive', 'missing manifest.json')))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== 'manifest.json') return zip.readEntry()
        readEntryText(zip, entry).then(resolve, reject)
      })
      zip.readEntry()
    })
    const parsed = manifestSchema.safeParse(JSON.parse(text))
    if (!parsed.success) throw new RestoreError('invalidArchive', 'invalid manifest.json')
    return parsed.data
  } catch (err) {
    if (err instanceof RestoreError) throw err
    throw new RestoreError('invalidArchive', (err as Error).message)
  } finally {
    zip.close()
  }
}

function validateData(rawData: Partial<Record<DataKey, unknown>>): ArchiveData {
  const out = {} as Record<DataKey, unknown>
  for (const [key, spec] of Object.entries(DATA_FILES) as [DataKey, (typeof DATA_FILES)[DataKey]][]) {
    const parsed = spec.schema.safeParse(rawData[key] ?? [])
    if (!parsed.success) throw new RestoreError('invalidArchive', `invalid ${spec.file}`)
    out[key] = parsed.data
  }
  return out as ArchiveData
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

// Orders self-referencing rows (comment replies, chat replies) so every
// parent is inserted before its children: createMany may split a large set
// into several INSERT statements, and a foreign key is checked per
// statement. A parent id that isn't in the set is left for the database to
// reject; a cycle can't come from a real export and is refused outright.
function parentsFirst<T extends { id: string }>(rows: T[], parentOf: (row: T) => string | null | undefined): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const depth = new Map<string, number>()
  const depthOf = (row: T): number => {
    const known = depth.get(row.id)
    if (known !== undefined) return known
    let d = 0
    let current: T | undefined = row
    const seen = new Set<string>()
    while (current) {
      const parentId = parentOf(current)
      const parent = parentId ? byId.get(parentId) : undefined
      if (!parent) break
      if (seen.has(parent.id)) throw new RestoreError('invalidArchive', 'reply cycle')
      seen.add(parent.id)
      d += 1
      current = parent
    }
    depth.set(row.id, d)
    return d
  }
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b))
}

async function insertAll(
  tx: Prisma.TransactionClient,
  data: ArchiveData,
  admin: RestoreAdmin | undefined,
  withCredentials: boolean
): Promise<{ adminUserId: string | null }> {
  const groupMembers = data.groups.flatMap((g) => g.members)
  const circleMembers = data.circles.flatMap((c) => c.members)

  // Insertion order follows the foreign keys: users and groups first, then
  // everything that references them.
  await tx.user.createMany({
    data: data.users.map(({ passwordHash, tokenVersion, ...u }) => ({
      ...u,
      email: u.email.toLowerCase().trim(),
      // A format-1 archive has no credentials; ignore a hand-added hash in one.
      passwordHash: withCredentials ? (passwordHash ?? null) : null,
      tokenVersion: restoredTokenVersion(tokenVersion),
    })),
  })

  // The person restoring becomes an admin with the password they just
  // chose. If the backup already has an account with their email, that
  // account is promoted — keeping it linked to everything they posted —
  // rather than a second, empty account being created next to it.
  let adminUserId: string | null = null
  if (admin) {
    const existing = await tx.user.findUnique({ where: { email: admin.email }, select: { id: true } })
    const adminUser = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash: admin.passwordHash, isAdmin: true },
          select: { id: true },
        })
      : await tx.user.create({
          data: { email: admin.email, name: admin.name, passwordHash: admin.passwordHash, isAdmin: true },
          select: { id: true },
        })
    adminUserId = adminUser.id
  }

  await tx.group.createMany({ data: data.groups.map(({ members: _members, ...g }) => g) })
  await tx.groupMember.createMany({ data: groupMembers })
  await tx.circle.createMany({ data: data.circles.map(({ members: _members, ...c }) => c) })
  await tx.circleMember.createMany({ data: circleMembers })
  await tx.mediaAlbumLink.createMany({ data: data.mediaAlbumLinks })
  await tx.mediaPersonLink.createMany({ data: data.mediaPersonLinks })
  await tx.post.createMany({ data: data.posts })
  await tx.postInteraction.createMany({ data: data.postInteractions })
  await tx.comment.createMany({ data: parentsFirst(data.comments, (c) => c.parentId) })
  await tx.like.createMany({ data: data.reactions })
  await tx.favorite.createMany({ data: data.favorites })
  await tx.chatMessage.createMany({ data: parentsFirst(data.chatMessages, (m) => m.replyToMessageId) })
  await tx.chatRead.createMany({ data: data.chatReads })
  // Motion rows may follow their photos in the archive. Restore the links
  // only after all referenced asset keys exist.
  await tx.upload.createMany({
    data: data.uploads.map(({ motionAssetKey: _motion, ...upload }) => ({
      ...upload,
      ...(upload.processingStatus === 'queued' || upload.processingStatus === 'processing'
        ? { processingStatus: 'queued', processingStartedAt: null, processingError: null }
        : {}),
    })),
  })
  for (const upload of data.uploads) {
    if (upload.motionAssetKey) {
      await tx.upload.update({ where: { assetKey: upload.assetKey }, data: { motionAssetKey: upload.motionAssetKey } })
    }
  }
  await tx.story.createMany({
    data: data.highlights.map(({ reactions: _reactions, expiresAt, ...story }) => ({
      ...story,
      // A Highlight has long since expired; an archive without the column
      // gets the lifetime it would have had.
      expiresAt: expiresAt ?? new Date(story.createdAt.getTime() + 24 * 60 * 60 * 1000),
    })),
  })
  await tx.storyReaction.createMany({
    data: data.highlights.flatMap((story) => story.reactions.map((r) => ({ ...r, storyId: story.id }))),
  })
  await tx.giftListGuest.createMany({ data: data.giftListGuests })
  await tx.giftListItem.createMany({ data: data.giftListItems })
  await tx.giftDrawAssignment.createMany({ data: data.giftDrawAssignments })
  await tx.wikiPage.createMany({ data: data.wikiPages })
  for (const row of [...data.branding, ...data.settings]) {
    await tx.setting.upsert({ where: { key: row.key }, update: { value: row.value }, create: row })
  }

  return { adminUserId }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

// Installs extracted media into the active storage backend, keeping branding
// local and preserving every relative path — the /uploads/<uuid>.jpg URLs stored in the
// restored rows resolve unchanged.
async function installFiles(fromDir: string, toDir: string, prefix = ''): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(fromDir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  await fsp.mkdir(toDir, { recursive: true })
  for (const entry of entries) {
    const from = path.join(fromDir, entry.name)
    const to = path.join(toDir, entry.name)
    const key = prefix + entry.name
    if (entry.isDirectory()) await installFiles(from, to, `${key}/`)
    else if (entry.isFile()) {
      if (key.startsWith('branding/')) await fsp.rename(from, to)
      else await getStorage().put(key, { filePath: from })
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RestoreAdmin {
  email: string
  name: string
  passwordHash: string
}

export interface RestoreOptions {
  zipPath: string
  // Scratch directory for extracted files — must be on the same filesystem
  // as uploadsDir (the caller creates it under uploadsDir with
  // RESTORE_WORKDIR_PREFIX) and is left for the caller to remove.
  workDir: string
  // Required for a format-1 archive (no credentials), or one without any
  // admin account; optional otherwise (RestoreError 'adminRequired').
  admin?: RestoreAdmin
  // The advisory lock POST /api/auth/setup takes, so a restore and a setup
  // can't both see "no users yet".
  lockKey: bigint
  // Where to look for media the archive doesn't contain (tests override it).
  mirrorDir?: string
}

export interface RestoreResult {
  // The restoring admin's account, when `admin` was given. null: everyone
  // signs in with their restored account, so no session is issued.
  adminUserId: string | null
  counts: RestoreCounts
  manifest: ArchiveManifest
}

export async function restoreArchive(opts: RestoreOptions): Promise<RestoreResult> {
  const filesDir = path.join(opts.workDir, 'files')
  await fsp.mkdir(filesDir, { recursive: true })

  const { manifest, rawData, fileCount } = await readArchive(opts.zipPath, filesDir)
  if (isNewerVersion(manifest.serverVersion, pkg.version)) {
    throw new RestoreError('archiveTooNew')
  }
  const data = validateData(rawData)
  const withCredentials = manifest.format >= 2 && manifest.credentials
  if (!opts.admin && !(withCredentials && data.users.some((u) => u.isAdmin))) {
    throw new RestoreError('adminRequired')
  }

  let mirroredFiles = 0
  if (!manifest.includeMedia) {
    for (const object of manifest.requiredMedia) {
      try {
        assertValidStorageKey(object.key)
      } catch {
        throw new RestoreError('invalidArchive', 'Invalid media key')
      }
    }
    // Cheap early refusal before copying media into a server that isn't
    // empty; repeated under the lock below.
    if ((await prisma.user.count()) > 0) throw new RestoreError('notEmpty')
    // Whatever storage still holds is used as is; the rest comes from the
    // backups volume's mirror. Nothing is copied unless everything is there.
    const media = await restoreRequiredMedia(manifest.requiredMedia, opts.mirrorDir ?? BACKUP_UPLOADS_DIR)
    if (media.missing.length)
      throw new RestoreError('missingMedia', 'Required media is missing or has a different size', media.missing)
    mirroredFiles = media.restored
  }

  let adminUserId: string | null
  try {
    ;({ adminUserId } = await prisma.$transaction(
      async (tx) => {
        // Try, don't wait: a dump restore holds this key for as long as it runs.
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${opts.lockKey}) AS locked
        `
        if (!locked) throw new RestoreError('busy')
        if ((await tx.user.count()) > 0) throw new RestoreError('notEmpty')
        const result = await insertAll(tx, data, opts.admin, withCredentials)
        await installFiles(filesDir, uploadsDir)
        return result
      },
      // A large family's history is a lot of rows; the default 5s
      // interactive-transaction timeout is sized for request handlers.
      { maxWait: 30_000, timeout: 30 * 60_000 }
    ))
  } catch (err) {
    if (err instanceof RestoreError) throw err
    // A dangling reference or duplicate id: the archive isn't internally
    // consistent (hand-edited, or truncated), so nothing was written.
    if (err instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003'].includes(err.code)) {
      throw new RestoreError('invalidArchive', err.message)
    }
    throw err
  }

  // Media installation succeeded before committing the restored rows.
  if (data.branding.length > 0 || data.settings.length > 0) invalidateSettingsCache()

  const counts: RestoreCounts = {
    users: data.users.length,
    groups: data.groups.length,
    groupMembers: data.groups.reduce((n, g) => n + g.members.length, 0),
    circles: data.circles.length,
    circleMembers: data.circles.reduce((n, c) => n + c.members.length, 0),
    posts: data.posts.length,
    postInteractions: data.postInteractions.length,
    comments: data.comments.length,
    reactions: data.reactions.length,
    favorites: data.favorites.length,
    chatMessages: data.chatMessages.length,
    chatReads: data.chatReads.length,
    mediaAlbumLinks: data.mediaAlbumLinks.length,
    mediaPersonLinks: data.mediaPersonLinks.length,
    uploads: data.uploads.length,
    highlights: data.highlights.length,
    branding: data.branding.length,
    settings: data.settings.length,
    giftListGuests: data.giftListGuests.length,
    giftListItems: data.giftListItems.length,
    giftDrawAssignments: data.giftDrawAssignments.length,
    wikiPages: data.wikiPages.length,
    files: fileCount,
    mirroredFiles,
  }

  return { adminUserId, counts, manifest }
}
