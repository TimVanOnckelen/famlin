// Admin-only full data export: everything a family would consider "their
// content" — users (safe fields only), groups/membership, circles and their
// members, posts (with poll votes and other per-type interactions),
// comments, reactions, favorites, chat messages and read positions, linked
// media albums and people mappings, the Upload access-index rows, and the
// whole uploads directory (including originals) — bundled as a single zip
// archive. services/import.ts is its inverse: restoring the archive into an
// empty instance (POST /api/auth/setup/restore).
//
// Circles, Upload rows, and MediaAlbumLink rows are part of the archive for
// correctness, not completeness: without Circle/CircleMember a restored
// circle-private post has no audience, without Upload its media reverts to
// "no row = readable by everyone", and without the album link every post
// embedding a /api/media/assets/<linkId>/... URL breaks for good. Links carry
// no credentials — the provider's connection details stay in `Setting`.
//
// Deliberately EXCLUDED, and why:
//  - `Setting` rows: contain SMTP credentials, OIDC client secret, and the
//    Immich API key — server configuration, not family content.
//  - `User.passwordHash`/`tokenVersion`: credentials/session-invalidation
//    state, never safe to export.
//  - `Invite`: a live, unexpired invite token grants access to the server;
//    exporting it would hand out a working credential.
//  - `PushToken`/`ApiToken`: device push tokens and personal access token
//    hashes are per-device/per-integration credentials, not family content.
//  - `Notification`/`PushDeliveryLog`: internal delivery/telemetry history,
//    not something a family needs in a portable export.
//
// new ZipArchive({ store: true }) uses store (no deflate) rather than
// compression: most of the archive's bytes are already-compressed photos/
// videos in uploads/, so compression buys little, and store mode keeps the
// stream fast and the resulting file trivially predictable in tests.
import { ZipArchive, type Archiver } from 'archiver';
import fs from 'fs';
import { prisma } from '../db.js';
import { uploadsDir } from '../config.js';
import pkg from '../../package.json' with { type: 'json' };
import { RESTORE_WORKDIR_PREFIX } from './import.js';

// This function does NOT call archive.finalize() — the caller (the export
// route) owns finalizing once it has attached the archive to the response
// stream, so headers can be sent before/while archiver produces bytes.
export async function buildExportArchive(): Promise<Archiver> {
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
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isAdmin: true,
        createdAt: true,
        emailOnNewPost: true,
        emailOnNewComment: true,
        emailOnNewLike: true,
        pushOnNewPost: true,
        pushOnNewComment: true,
        pushOnNewLike: true,
        pushOnChitchat: true,
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
  ]);

  const archive: Archiver = new ZipArchive({ store: true });

  const manifest = {
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
    },
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.append(JSON.stringify(users, null, 2), { name: 'data/users.json' });
  archive.append(JSON.stringify(groups, null, 2), { name: 'data/groups.json' });
  archive.append(JSON.stringify(circles, null, 2), { name: 'data/circles.json' });
  archive.append(JSON.stringify(posts, null, 2), { name: 'data/posts.json' });
  archive.append(JSON.stringify(postInteractions, null, 2), { name: 'data/post-interactions.json' });
  archive.append(JSON.stringify(comments, null, 2), { name: 'data/comments.json' });
  archive.append(JSON.stringify(reactions, null, 2), { name: 'data/reactions.json' });
  archive.append(JSON.stringify(favorites, null, 2), { name: 'data/favorites.json' });
  archive.append(JSON.stringify(chatMessages, null, 2), { name: 'data/chat-messages.json' });
  archive.append(JSON.stringify(chatReads, null, 2), { name: 'data/chat-reads.json' });
  archive.append(JSON.stringify(mediaAlbumLinks, null, 2), { name: 'data/media-album-links.json' });
  archive.append(JSON.stringify(mediaPersonLinks, null, 2), { name: 'data/media-person-links.json' });
  archive.append(JSON.stringify(uploads, null, 2), { name: 'data/uploads.json' });

  // Fresh installs may not have an uploads directory yet — skip silently
  // rather than failing the whole export.
  if (fs.existsSync(uploadsDir)) {
    // Skips the scratch directory of a restore (services/import.ts) that is
    // in progress or was interrupted — it's a half-extracted archive, not
    // family media.
    archive.directory(uploadsDir, 'uploads', (entry) =>
      entry.name.startsWith(`uploads/${RESTORE_WORKDIR_PREFIX}`) ? false : entry
    );
  }

  return archive;
}
