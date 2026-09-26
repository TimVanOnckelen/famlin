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
// What the archive cannot bring back (export.ts excludes it on purpose):
// settings (OIDC/SMTP/media connections), password hashes, invites, push and
// API tokens, notification history. So a restored instance's members cannot
// log in until an admin reconfigures SSO or resets their passwords — the
// person restoring gets an admin login out of the same request (see
// `admin` below), which is what makes that possible at all.
import { Prisma, ReactionType, NewAssetMode } from '@prisma/client';
import { z } from 'zod';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import yauzl from 'yauzl';
import { prisma } from '../db.js';
import { uploadsDir } from '../config.js';
import pkg from '../../package.json' with { type: 'json' };

export type RestoreErrorCode = 'invalidArchive' | 'archiveTooNew' | 'notEmpty';

export class RestoreError extends Error {
  constructor(public readonly code: RestoreErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RestoreError';
  }
}

// Restored users get a tokenVersion no real deployment reaches by bumping
// it one password change at a time. tokenVersion itself isn't in the archive
// (export.ts), and resetting everyone to the default 0 would bring back
// every JWT a password reset had revoked, on a server restored with the
// same JWT_SECRET. Starting above any plausible old value invalidates every
// token issued before the restore instead.
export const RESTORED_TOKEN_VERSION = 1_000_000;

// Prefix of the per-request working directory, created INSIDE uploadsDir so
// the final move of each extracted file into place is a same-filesystem
// rename (uploadsDir is usually its own Docker volume), and so a multi-GB
// upload is spooled to the volume sized for media rather than the
// container's /tmp. export.ts skips it.
export const RESTORE_WORKDIR_PREFIX = '.restore-';

// ---------------------------------------------------------------------------
// Archive row schemas. The archive is untrusted input, so every row is
// validated and reduced to the columns Famlin actually has — an unknown key
// (say, a hand-added `passwordHash`) is stripped rather than written. Fields
// added to the export after its first version are optional, so an older
// archive restores with those columns at their schema defaults.
// ---------------------------------------------------------------------------

const id = z.string().min(1);
const date = z.coerce.date();
const nullableDate = z.coerce.date().nullable().optional();
const nullableString = z.string().nullable().optional();
const optionalBool = z.boolean().optional();
// Json columns: `null` in the archive means SQL NULL, which Prisma requires
// spelling as Prisma.DbNull.
const nullableJson = z
  .unknown()
  .transform((v) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue)));

const userRow = z.object({
  id,
  email: z.string().min(1),
  name: z.string(),
  avatarUrl: nullableString,
  isAdmin: z.boolean(),
  createdAt: date,
  emailOnNewPost: optionalBool,
  emailOnNewComment: optionalBool,
  emailOnNewLike: optionalBool,
  pushOnNewPost: optionalBool,
  pushOnNewComment: optionalBool,
  pushOnNewLike: optionalBool,
  pushOnChitchat: optionalBool,
});

const groupMemberRow = z.object({ id, groupId: id, userId: id, joinedAt: date });

const groupRow = z.object({
  id,
  name: z.string(),
  description: nullableString,
  allowedPostTypes: z.array(z.string()).optional(),
  chitchatEnabled: optionalBool,
  createdAt: date,
  members: z.array(groupMemberRow).default([]),
});

const circleMemberRow = z.object({ id, circleId: id, userId: id, joinedAt: date });

const circleRow = z.object({
  id,
  groupId: id,
  name: z.string(),
  description: nullableString,
  avatarUrl: nullableString,
  createdById: nullableString,
  createdAt: date,
  updatedAt: date,
  members: z.array(circleMemberRow).default([]),
});

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
});

const postInteractionRow = z.object({
  id,
  postId: id,
  userId: id,
  key: z.string(),
  value: z.unknown().transform((v) => (v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue))),
  createdAt: date,
});

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
});

const reactionRow = z.object({
  id,
  postId: nullableString,
  commentId: nullableString,
  userId: id,
  type: z.enum(ReactionType).optional(),
  createdAt: date,
});

const favoriteRow = z.object({ id, postId: id, userId: id, createdAt: date });

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
});

const chatReadRow = z.object({ id, groupId: id, userId: id, lastReadAt: date });

const mediaAlbumLinkRow = z.object({
  id,
  groupId: id,
  provider: z.string().optional(),
  externalAlbumId: z.string(),
  albumName: z.string(),
  createdAt: date,
  newAssetMode: z.enum(NewAssetMode).optional(),
  newAssetsCheckedAt: nullableDate,
});

const mediaPersonLinkRow = z.object({
  id,
  provider: z.string(),
  externalPersonId: z.string(),
  label: z.string(),
  userId: nullableString,
  createdAt: date,
});

const uploadRow = z.object({
  id,
  assetKey: z.string().min(1),
  uploaderId: nullableString,
  circleId: nullableString,
  bound: z.boolean(),
  createdAt: date,
});

const manifestSchema = z.object({
  serverVersion: z.string(),
});

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
} as const;

type DataKey = keyof typeof DATA_FILES;
type ArchiveData = { [K in DataKey]: z.output<(typeof DATA_FILES)[K]['schema']> };
export type RestoreCounts = Record<DataKey | 'groupMembers' | 'circleMembers' | 'files', number>;

// A single JSON entry is held in memory to parse it; anything this large is
// not an export from a family server.
const MAX_JSON_ENTRY_BYTES = 1024 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

function parseVersion(v: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

// True when `archiveVersion` is newer than `serverVersion` — such an archive
// may carry columns/semantics this server's schema doesn't have yet.
export function isNewerVersion(archiveVersion: string, serverVersion: string): boolean {
  const a = parseVersion(archiveVersion);
  const s = parseVersion(serverVersion);
  if (!a || !s) throw new RestoreError('invalidArchive', `unparseable version: ${archiveVersion}`);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== s[i]) return a[i] > s[i];
  }
  return false;
}

// ---------------------------------------------------------------------------
// Zip reading
// ---------------------------------------------------------------------------

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) reject(new RestoreError('invalidArchive', err?.message));
      else resolve(zip);
    });
  });
}

function openEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error('no stream'));
      else resolve(stream);
    });
  });
}

async function readEntryText(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  if (entry.uncompressedSize > MAX_JSON_ENTRY_BYTES) {
    throw new RestoreError('invalidArchive', `${entry.fileName} is too large`);
  }
  const stream = await openEntryStream(zip, entry);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function isSymlink(entry: yauzl.Entry): boolean {
  // Unix mode lives in the high 16 bits of the external attributes.
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

interface ReadArchiveResult {
  manifest: z.output<typeof manifestSchema>;
  rawData: Partial<Record<DataKey, unknown>>;
  fileCount: number;
}

// Walks the archive once: JSON entries are parsed in memory, every
// uploads/** file is streamed to `filesDir` (never straight into
// uploadsDir — nothing touches the live media directory until the database
// half has committed). yauzl itself rejects absolute paths and `..`
// segments; the resolved-path check below is the belt to that brace.
async function readArchive(zipPath: string, filesDir: string): Promise<ReadArchiveResult> {
  const zip = await openZip(zipPath);
  const jsonByName = new Map<string, string>();
  const wantedJson = new Set<string>(['manifest.json', ...Object.values(DATA_FILES).map((d) => d.file)]);
  let fileCount = 0;

  await new Promise<void>((resolve, reject) => {
    const fail = (err: unknown) => {
      zip.close();
      reject(err instanceof RestoreError ? err : new RestoreError('invalidArchive', (err as Error)?.message));
    };

    zip.on('error', fail);
    zip.on('end', () => resolve());
    zip.on('entry', (entry: yauzl.Entry) => {
      (async () => {
        const name = entry.fileName;
        if (name.endsWith('/') || isSymlink(entry)) return;

        if (wantedJson.has(name)) {
          jsonByName.set(name, await readEntryText(zip, entry));
          return;
        }

        if (name.startsWith('uploads/')) {
          const rel = name.slice('uploads/'.length);
          if (!rel || rel.startsWith(RESTORE_WORKDIR_PREFIX)) return;
          const target = path.resolve(filesDir, rel);
          if (!target.startsWith(filesDir + path.sep)) {
            throw new RestoreError('invalidArchive', `unsafe path: ${name}`);
          }
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await pipeline(await openEntryStream(zip, entry), fs.createWriteStream(target));
          fileCount += 1;
        }
        // Anything else in the zip is ignored.
      })().then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });

  const parseJson = (name: string): unknown => {
    try {
      return JSON.parse(jsonByName.get(name)!);
    } catch {
      throw new RestoreError('invalidArchive', `${name} is not valid JSON`);
    }
  };

  if (!jsonByName.has('manifest.json')) throw new RestoreError('invalidArchive', 'missing manifest.json');
  const manifest = manifestSchema.safeParse(parseJson('manifest.json'));
  if (!manifest.success) throw new RestoreError('invalidArchive', 'invalid manifest.json');

  const rawData: Partial<Record<DataKey, unknown>> = {};
  for (const [key, spec] of Object.entries(DATA_FILES) as [DataKey, (typeof DATA_FILES)[DataKey]][]) {
    if (jsonByName.has(spec.file)) rawData[key] = parseJson(spec.file);
    else if (spec.required) throw new RestoreError('invalidArchive', `missing ${spec.file}`);
  }

  return { manifest: manifest.data, rawData, fileCount };
}

function validateData(rawData: Partial<Record<DataKey, unknown>>): ArchiveData {
  const out = {} as Record<DataKey, unknown>;
  for (const [key, spec] of Object.entries(DATA_FILES) as [DataKey, (typeof DATA_FILES)[DataKey]][]) {
    const parsed = spec.schema.safeParse(rawData[key] ?? []);
    if (!parsed.success) throw new RestoreError('invalidArchive', `invalid ${spec.file}`);
    out[key] = parsed.data;
  }
  return out as ArchiveData;
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
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = new Map<string, number>();
  const depthOf = (row: T): number => {
    const known = depth.get(row.id);
    if (known !== undefined) return known;
    let d = 0;
    let current: T | undefined = row;
    const seen = new Set<string>();
    while (current) {
      const parentId = parentOf(current);
      const parent = parentId ? byId.get(parentId) : undefined;
      if (!parent) break;
      if (seen.has(parent.id)) throw new RestoreError('invalidArchive', 'reply cycle');
      seen.add(parent.id);
      d += 1;
      current = parent;
    }
    depth.set(row.id, d);
    return d;
  };
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b));
}

async function insertAll(
  tx: Prisma.TransactionClient,
  data: ArchiveData,
  admin: RestoreAdmin
): Promise<{ adminUserId: string }> {
  const groupMembers = data.groups.flatMap((g) => g.members);
  const circleMembers = data.circles.flatMap((c) => c.members);

  // Insertion order follows the foreign keys: users and groups first, then
  // everything that references them.
  await tx.user.createMany({
    data: data.users.map((u) => ({ ...u, email: u.email.toLowerCase().trim(), tokenVersion: RESTORED_TOKEN_VERSION })),
  });

  // The person restoring becomes an admin with the password they just
  // chose. If the backup already has an account with their email, that
  // account is promoted — keeping it linked to everything they posted —
  // rather than a second, empty account being created next to it.
  const existing = await tx.user.findUnique({ where: { email: admin.email }, select: { id: true } });
  const adminUser = existing
    ? await tx.user.update({
        where: { id: existing.id },
        data: { passwordHash: admin.passwordHash, isAdmin: true },
        select: { id: true },
      })
    : await tx.user.create({
        data: { email: admin.email, name: admin.name, passwordHash: admin.passwordHash, isAdmin: true },
        select: { id: true },
      });

  await tx.group.createMany({ data: data.groups.map(({ members: _members, ...g }) => g) });
  await tx.groupMember.createMany({ data: groupMembers });
  await tx.circle.createMany({ data: data.circles.map(({ members: _members, ...c }) => c) });
  await tx.circleMember.createMany({ data: circleMembers });
  await tx.mediaAlbumLink.createMany({ data: data.mediaAlbumLinks });
  await tx.mediaPersonLink.createMany({ data: data.mediaPersonLinks });
  await tx.post.createMany({ data: data.posts });
  await tx.postInteraction.createMany({ data: data.postInteractions });
  await tx.comment.createMany({ data: parentsFirst(data.comments, (c) => c.parentId) });
  await tx.like.createMany({ data: data.reactions });
  await tx.favorite.createMany({ data: data.favorites });
  await tx.chatMessage.createMany({ data: parentsFirst(data.chatMessages, (m) => m.replyToMessageId) });
  await tx.chatRead.createMany({ data: data.chatReads });
  await tx.upload.createMany({ data: data.uploads });

  return { adminUserId: adminUser.id };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

// Moves every extracted file from the working directory into uploadsDir,
// preserving its relative path — the /uploads/<uuid>.jpg URLs stored in the
// restored rows resolve unchanged.
async function installFiles(fromDir: string, toDir: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(fromDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  await fsp.mkdir(toDir, { recursive: true });
  for (const entry of entries) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) await installFiles(from, to);
    else if (entry.isFile()) await fsp.rename(from, to);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RestoreAdmin {
  email: string;
  name: string;
  passwordHash: string;
}

export interface RestoreOptions {
  zipPath: string;
  // Scratch directory for extracted files — must be on the same filesystem
  // as uploadsDir (the caller creates it under uploadsDir with
  // RESTORE_WORKDIR_PREFIX) and is left for the caller to remove.
  workDir: string;
  admin: RestoreAdmin;
  // The advisory lock POST /api/auth/setup takes, so a restore and a setup
  // can't both see "no users yet".
  lockKey: bigint;
}

export async function restoreArchive(opts: RestoreOptions): Promise<{ adminUserId: string; counts: RestoreCounts }> {
  const filesDir = path.join(opts.workDir, 'files');
  await fsp.mkdir(filesDir, { recursive: true });

  const { manifest, rawData, fileCount } = await readArchive(opts.zipPath, filesDir);
  if (isNewerVersion(manifest.serverVersion, pkg.version)) {
    throw new RestoreError('archiveTooNew');
  }
  const data = validateData(rawData);

  let adminUserId: string;
  try {
    ({ adminUserId } = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${opts.lockKey})`;
        if ((await tx.user.count()) > 0) throw new RestoreError('notEmpty');
        return insertAll(tx, data, opts.admin);
      },
      // A large family's history is a lot of rows; the default 5s
      // interactive-transaction timeout is sized for request handlers.
      { maxWait: 30_000, timeout: 30 * 60_000 }
    ));
  } catch (err) {
    if (err instanceof RestoreError) throw err;
    // A dangling reference or duplicate id: the archive isn't internally
    // consistent (hand-edited, or truncated), so nothing was written.
    if (err instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003'].includes(err.code)) {
      throw new RestoreError('invalidArchive', err.message);
    }
    throw err;
  }

  // Only now, with the rows committed, does anything touch the live media
  // directory.
  await installFiles(filesDir, uploadsDir);

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
    files: fileCount,
  };

  return { adminUserId, counts };
}
