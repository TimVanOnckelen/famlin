// Admin-only full backup ("Famlin backup", issue #461): everything a family
// needs to come back on a new server — users (with their password hashes),
// groups/membership, circles and their members, posts (with poll votes and
// other per-type interactions), gift list wishes and Secret Santa pairings,
// comments, reactions, favorites, chat messages and read positions, linked
// media albums and people mappings, the Upload access-index rows, server
// settings minus credentials, branding, and (optionally) the whole uploads
// directory — bundled as a single zip archive. The manual download
// (GET /api/admin/export) and the scheduled backups (services/backup/)
// produce this same format. services/import.ts is its inverse: restoring the
// archive into an empty instance (POST /api/auth/setup/restore).
//
// Circles, Upload rows, and MediaAlbumLink rows are part of the archive for
// correctness, not completeness: without Circle/CircleMember a restored
// circle-private post has no audience, without Upload its media reverts to
// "no row = readable by everyone", and without the album link every post
// embedding a /api/media/assets/<linkId>/... URL breaks for good. Links carry
// no credentials — the provider's connection details stay in `Setting`.
//
// Password hashes are in (format 2+) so members can sign in after a restore
// exactly as before: a backup file is therefore as sensitive as the database
// itself (docs/docs/security.md). `tokenVersion` is in so a restore can
// invalidate every session issued before it (see RESTORED_TOKEN_VERSION).
//
// Deliberately EXCLUDED, and why:
//  - Credential `Setting` rows (SECRET_SETTING_KEYS: OIDC client secret,
//    SMTP password, Immich API key): re-entered by an admin after a restore,
//    so a backup file never carries a working third-party credential.
//  - `Invite`: a live, unexpired invite token grants access to the server;
//    exporting it would hand out a working credential.
//  - `ApiToken`: a token revoked after a leak must not come back through a
//    restore; members create new ones.
//  - `Device`/`PushToken`: device diagnostics and push tokens are
//    operational state that the apps re-register on their own.
//  - `Notification`/`PushDeliveryLog`: internal delivery/telemetry history,
//    not something a family needs in a portable export.
//  - Live (unpinned) stories, story views and private story replies: a live
//    story is about to be deleted anyway, and replies are private between a
//    viewer and the author. Only pinned stories (Highlights) and their
//    reactions are family content worth backing up — and a live story's
//    photo is filtered out of the uploads/ directory below for the same
//    reason.
//
// new ZipArchive({ store: true }) uses store (no deflate) rather than
// compression: most of the archive's bytes are already-compressed photos/
// videos in uploads/, so compression buys little, and store mode keeps the
// stream fast and the resulting file trivially predictable in tests.
import { ZipArchive, type Archiver } from 'archiver'
import fs from 'fs'
import { prisma } from '../db.js'
import { uploadsDir } from '../config.js'
import { uploadAssetKey } from './uploads.js'
import { BRANDING_SETTING_KEYS } from './branding/index.js'
import { RESTORABLE_SETTING_KEYS } from './settings.js'
import pkg from '../../package.json' with { type: 'json' }
import { getStorage } from './storage/registry.js'
import { appendStoredObject } from './storage/archive.js'
import path from 'node:path'

// Format history: 1 (no `format` field) = the original export, without
// credentials or settings; 2 = adds password hashes, tokenVersion, settings
// and `mediaLocation`.
export const BACKUP_FORMAT = 2

// Where the restore finds the media of an archive built without them:
// 'storage' = still in the server's media storage (S3, or a manual
// export of a server whose uploads volume survives), 'mirror' = in the
// backups volume's incremental mirror (scheduled backups).
export type MediaLocation = 'archive' | 'storage' | 'mirror'

// This function does NOT call archive.finalize() — the caller (the export
// route) owns finalizing once it has attached the archive to the response
// stream, so headers can be sent before/while archiver produces bytes.
// `onError` is attached as soon as the archive exists: a media entry can fail
// (and fail the archive) while the rest is still being built.
export async function buildExportArchive(
  includeMedia: boolean,
  onError: (err: Error) => void,
  options: { mediaLocation?: Exclude<MediaLocation, 'archive'> } = {}
): Promise<Archiver> {
  const [
    users,
    groups,
    circles,
    posts,
    postInteractions,
    comments,
    reactions,
    favorites,
    chatMessages,
    chatReads,
    mediaAlbumLinks,
    mediaPersonLinks,
    uploads,
    highlights,
    liveStories,
    giftListItems,
    giftListGuests,
    giftDrawAssignments,
    wikiPages,
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        passwordHash: true,
        tokenVersion: true,
        isAdmin: true,
        createdAt: true,
        emailOnNewPost: true,
        emailOnNewComment: true,
        emailOnNewLike: true,
        pushOnNewPost: true,
        pushOnNewComment: true,
        pushOnNewLike: true,
        pushOnChitchat: true,
        pushOnStory: true,
        pushOnGiftList: true,
      },
    }),
    prisma.group.findMany({
      include: {
        members: true,
      },
    }),
    prisma.circle.findMany({
      include: {
        members: true,
      },
    }),
    prisma.post.findMany(),
    prisma.postInteraction.findMany(),
    prisma.comment.findMany(),
    prisma.like.findMany(),
    prisma.favorite.findMany(),
    prisma.chatMessage.findMany(),
    prisma.chatRead.findMany(),
    prisma.mediaAlbumLink.findMany(),
    prisma.mediaPersonLink.findMany(),
    prisma.upload.findMany(),
    prisma.story.findMany({
      where: { pinnedAt: { not: null } },
      select: {
        id: true,
        authorId: true,
        groupId: true,
        circleId: true,
        crossStoryId: true,
        imageUrl: true,
        createdAt: true,
        expiresAt: true,
        pinnedAt: true,
        reactions: { select: { id: true, userId: true, type: true, createdAt: true } },
      },
    }),
    prisma.story.findMany({ where: { pinnedAt: null }, select: { imageUrl: true } }),
    prisma.giftListItem.findMany(),
    prisma.giftListGuest.findMany(),
    // Secret Santa pairings: a backup must restore a gift list exactly, so
    // they're in the archive — the one place the full set leaves the
    // database (an admin-only download, never a member-facing response).
    prisma.giftDrawAssignment.findMany(),
    prisma.wikiPage.findMany(),
  ])
  // Per-family branding is family identity, not server config: its Setting
  // rows travel with the archive (the logo files ride along in
  // uploads/branding/ below). Every other Setting row stays excluded.
  const branding = await prisma.setting.findMany({
    where: { key: { in: [...BRANDING_SETTING_KEYS] } },
    select: { key: true, value: true },
  })
  // Server settings minus credentials (RESTORABLE_SETTING_KEYS). Only rows an
  // admin actually saved: an unset one keeps following the default.
  const settings = await prisma.setting.findMany({
    where: { key: { in: [...RESTORABLE_SETTING_KEYS] } },
    select: { key: true, value: true },
    orderBy: { key: 'asc' },
  })

  const archive: Archiver = new ZipArchive({ store: true })
  archive.on('error', onError)

  const requiredMedia: { key: string; size: number }[] = []

  const manifest = {
    format: BACKUP_FORMAT,
    // The users file carries password hashes: no admin account needs to be
    // created on restore.
    credentials: true,
    includeMedia,
    mediaLocation: (includeMedia ? 'archive' : (options.mediaLocation ?? 'storage')) satisfies MediaLocation,
    requiredMedia,
    exportedAt: new Date().toISOString(),
    serverVersion: pkg.version,
    counts: {
      users: users.length,
      groups: groups.length,
      circles: circles.length,
      posts: posts.length,
      postInteractions: postInteractions.length,
      comments: comments.length,
      reactions: reactions.length,
      favorites: favorites.length,
      chatMessages: chatMessages.length,
      chatReads: chatReads.length,
      mediaAlbumLinks: mediaAlbumLinks.length,
      mediaPersonLinks: mediaPersonLinks.length,
      uploads: uploads.length,
      highlights: highlights.length,
      giftListItems: giftListItems.length,
      giftListGuests: giftListGuests.length,
      giftDrawAssignments: giftDrawAssignments.length,
      wikiPages: wikiPages.length,
      branding: branding.length,
      settings: settings.length,
    },
  }

  archive.append(JSON.stringify(users, null, 2), { name: 'data/users.json' })
  archive.append(JSON.stringify(groups, null, 2), { name: 'data/groups.json' })
  archive.append(JSON.stringify(circles, null, 2), { name: 'data/circles.json' })
  archive.append(JSON.stringify(posts, null, 2), { name: 'data/posts.json' })
  archive.append(JSON.stringify(postInteractions, null, 2), { name: 'data/post-interactions.json' })
  archive.append(JSON.stringify(comments, null, 2), { name: 'data/comments.json' })
  archive.append(JSON.stringify(reactions, null, 2), { name: 'data/reactions.json' })
  archive.append(JSON.stringify(favorites, null, 2), { name: 'data/favorites.json' })
  archive.append(JSON.stringify(chatMessages, null, 2), { name: 'data/chat-messages.json' })
  archive.append(JSON.stringify(chatReads, null, 2), { name: 'data/chat-reads.json' })
  archive.append(JSON.stringify(mediaAlbumLinks, null, 2), { name: 'data/media-album-links.json' })
  archive.append(JSON.stringify(mediaPersonLinks, null, 2), { name: 'data/media-person-links.json' })
  archive.append(JSON.stringify(highlights, null, 2), { name: 'data/highlights.json' })
  archive.append(JSON.stringify(branding, null, 2), { name: 'data/branding.json' })
  archive.append(JSON.stringify(settings, null, 2), { name: 'data/settings.json' })
  archive.append(JSON.stringify(giftListGuests, null, 2), { name: 'data/gift-list-guests.json' })
  archive.append(JSON.stringify(giftListItems, null, 2), { name: 'data/gift-list-items.json' })
  archive.append(JSON.stringify(giftDrawAssignments, null, 2), { name: 'data/gift-draw-assignments.json' })
  archive.append(JSON.stringify(wikiPages, null, 2), { name: 'data/wiki-pages.json' })

  // A live story's photo shares the uploads/ directory with everything else,
  // so skip every rendition of it (served copy, thumbnail, original, derived)
  // by asset key — and its Upload row, so a restore doesn't recreate an
  // authorization row for a file that isn't in the archive. A cross-post
  // sibling that is pinned keeps the file in.
  const pinnedKeys = new Set(highlights.map((s) => uploadAssetKey(s.imageUrl)))
  for (const upload of uploads)
    if (pinnedKeys.has(upload.assetKey) && upload.motionAssetKey) pinnedKeys.add(upload.motionAssetKey)
  const liveOnlyKeys = new Set(liveStories.map((s) => uploadAssetKey(s.imageUrl)).filter((key) => !pinnedKeys.has(key)))
  for (const upload of uploads)
    if (liveOnlyKeys.has(upload.assetKey) && upload.motionAssetKey && !pinnedKeys.has(upload.motionAssetKey))
      liveOnlyKeys.add(upload.motionAssetKey)
  archive.append(
    JSON.stringify(
      uploads.filter((u) => !liveOnlyKeys.has(u.assetKey)),
      null,
      2
    ),
    { name: 'data/uploads.json' }
  )

  for await (const object of getStorage().list()) {
    if (archive.destroyed) break
    if (liveOnlyKeys.has(uploadAssetKey(object.key))) continue
    requiredMedia.push({ key: object.key, size: object.size })
    if (includeMedia) appendStoredObject(archive, object.key)
  }
  const brandingDir = path.join(uploadsDir, 'branding')
  if (fs.existsSync(brandingDir)) archive.directory(brandingDir, 'uploads/branding')
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })

  return archive
}
