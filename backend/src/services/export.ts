// Admin-only full data export: everything a family would consider "their
// content" — users (safe fields only), groups/membership, posts, comments,
// reactions, favorites, chat messages, and the whole uploads directory
// (including originals) — bundled as a single zip archive.
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
import path from 'path';
import { prisma } from '../db.js';
import pkg from '../../package.json' with { type: 'json' };

const uploadsDir = path.join(process.cwd(), 'uploads');

// This function does NOT call archive.finalize() — the caller (the export
// route) owns finalizing once it has attached the archive to the response
// stream, so headers can be sent before/while archiver produces bytes.
export async function buildExportArchive(): Promise<Archiver> {
  const [users, groups, posts, comments, reactions, favorites, chatMessages] = await Promise.all([
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
    prisma.post.findMany(),
    prisma.comment.findMany(),
    prisma.like.findMany(),
    prisma.favorite.findMany(),
    prisma.chatMessage.findMany(),
  ]);

  const archive: Archiver = new ZipArchive({ store: true });

  const manifest = {
    exportedAt: new Date().toISOString(),
    serverVersion: pkg.version,
    counts: {
      users: users.length,
      groups: groups.length,
      posts: posts.length,
      comments: comments.length,
      reactions: reactions.length,
      favorites: favorites.length,
      chatMessages: chatMessages.length,
    },
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.append(JSON.stringify(users, null, 2), { name: 'data/users.json' });
  archive.append(JSON.stringify(groups, null, 2), { name: 'data/groups.json' });
  archive.append(JSON.stringify(posts, null, 2), { name: 'data/posts.json' });
  archive.append(JSON.stringify(comments, null, 2), { name: 'data/comments.json' });
  archive.append(JSON.stringify(reactions, null, 2), { name: 'data/reactions.json' });
  archive.append(JSON.stringify(favorites, null, 2), { name: 'data/favorites.json' });
  archive.append(JSON.stringify(chatMessages, null, 2), { name: 'data/chat-messages.json' });

  // Fresh installs may not have an uploads directory yet — skip silently
  // rather than failing the whole export.
  if (fs.existsSync(uploadsDir)) {
    archive.directory(uploadsDir, 'uploads');
  }

  return archive;
}
