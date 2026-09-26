// Member self-service data export (GET /api/auth/me/export) — a keepsake zip
// of everything the calling member can already see in the app: every post in
// their groups (other members' included), the comments and reactions on
// those posts, their own favorites, their groups' chat, the profiles of the
// people they share a group with, and exactly the upload files all of that
// references.
//
// Deliberately a SEPARATE entry point from buildExportArchive() in
// export.ts, not a scope parameter on it: that function's whole design
// assumes the caller may see everything (bare findMany()s, the entire
// uploads directory), and making it conditional would turn "leaks every
// other family on the instance" into a one-argument mistake. Every query
// here starts from the caller's own GroupMember rows and composes
// visiblePostsWhere(), so a forgotten filter fails closed (an empty list)
// rather than open.
//
// The exclusions from export.ts's header all still apply — Setting,
// passwordHash/tokenVersion, Invite (a live credential), PushToken/ApiToken,
// Notification/PushDeliveryLog — plus a few that only matter once the
// caller isn't the server owner:
//  - Other members' email notification/push preferences and isAdmin: not
//    shown anywhere in the member-facing app. Other users get only the
//    fields the group member list already exposes (id, name, email, avatar).
//  - Other members' favorites: private bookmarks, never visible in the app.
//  - Post.crossPostId: never serialized to non-authors (see routes/posts.ts),
//    since it reveals a post was shared with groups the reader isn't in.
//  - Circle-private posts in circles the caller isn't in, and anything
//    hanging off them (comments, reactions, milestone chat messages).
//  - uploads/derived/ (regenerable HEIC renditions) and every file not
//    referenced by the exported rows — in particular other groups' media.
//
// Same store-mode and "caller owns finalize()" contract as export.ts.
import { ZipArchive, type Archiver } from 'archiver';
import fs from 'fs';
import path from 'path';
import { prisma } from '../db.js';
import { uploadsDir } from '../config.js';
import { getUserCircleIds, visiblePostsWhere } from './circles.js';
import { uploadAssetKey } from './uploads.js';
import pkg from '../../package.json' with { type: 'json' };

const ORIGINALS_DIR_NAME = 'originals';

// Matches every /uploads/<file> path embedded anywhere in the exported rows —
// uploadedAssetUrls, comment attachments/assetUrl, trip/album typeData cover
// photos, check-in metadata photoUrls, chat attachments, avatars — so a new
// field holding an upload path is picked up without touching this file.
const UPLOAD_PATH_RE = /\/uploads\/([A-Za-z0-9._-]+)/g;

export function collectUploadKeys(serialized: string): Set<string> {
  const keys = new Set<string>();
  for (const match of serialized.matchAll(UPLOAD_PATH_RE)) {
    keys.add(uploadAssetKey(match[1]));
  }
  return keys;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    // Fresh installs may not have an uploads (or originals) directory yet.
    return [];
  }
}

export async function buildMemberExportArchive(userId: string): Promise<Archiver> {
  const [memberships, circleIds] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    getUserCircleIds(userId),
  ]);
  const groupIds = memberships.map((m) => m.groupId);

  const [groups, posts, self] = await Promise.all([
    prisma.group.findMany({
      where: { id: { in: groupIds } },
      select: {
        id: true,
        name: true,
        description: true,
        chitchatEnabled: true,
        createdAt: true,
        members: { select: { userId: true, joinedAt: true } },
      },
    }),
    prisma.post.findMany({
      where: visiblePostsWhere(groupIds, circleIds),
      omit: { crossPostId: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
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
  ]);

  const postIds = posts.map((p) => p.id);
  const visiblePostIds = new Set(postIds);
  const chatGroupIds = groups.filter((g) => g.chitchatEnabled).map((g) => g.id);
  const otherUserIds = [...new Set(groups.flatMap((g) => g.members.map((m) => m.userId)))].filter(
    (id) => id !== userId
  );

  const [comments, favorites, chatMessages, otherUsers] = await Promise.all([
    prisma.comment.findMany({ where: { postId: { in: postIds } }, orderBy: { createdAt: 'asc' } }),
    prisma.favorite.findMany({ where: { userId, postId: { in: postIds } } }),
    // Only groups with chat switched on — a disabled group's chat is
    // unreadable in the app (403 errors.chitchatDisabled), so it's unreadable
    // here too. A SYSTEM_MILESTONE message about a circle post the caller
    // can't see is dropped below.
    prisma.chatMessage.findMany({ where: { groupId: { in: chatGroupIds } }, orderBy: { createdAt: 'asc' } }),
    prisma.user.findMany({
      where: { id: { in: otherUserIds } },
      select: { id: true, email: true, name: true, avatarUrl: true },
    }),
  ]);

  const commentIds = comments.map((c) => c.id);
  const reactions = await prisma.like.findMany({
    where: { OR: [{ postId: { in: postIds } }, { commentId: { in: commentIds } }] },
  });
  const visibleChat = chatMessages.filter((m) => !m.refPostId || visiblePostIds.has(m.refPostId));
  const users = [self, ...otherUsers];

  const data = {
    users,
    groups,
    posts,
    comments,
    reactions,
    favorites,
    chatMessages: visibleChat,
  };
  const serialized = Object.fromEntries(
    Object.entries(data).map(([key, rows]) => [key, JSON.stringify(rows, null, 2)])
  ) as Record<keyof typeof data, string>;

  // Upload files: only what the rows above reference, never the directory.
  // The rows are already scoped, so this should never drop anything — the
  // Upload-table check is belt and braces for the same canReadUpload() rule
  // /uploads/* enforces per request (services/uploads.ts): a circle-bound
  // file needs circle membership, an unbound draft is its uploader's only.
  const referencedKeys = collectUploadKeys(Object.values(serialized).join('\n'));
  const uploadRows = await prisma.upload.findMany({
    where: { assetKey: { in: [...referencedKeys] } },
    select: { assetKey: true, uploaderId: true, circleId: true, bound: true },
  });
  const circleSet = new Set(circleIds);
  for (const row of uploadRows) {
    const readable = row.circleId ? circleSet.has(row.circleId) : row.bound || row.uploaderId === userId;
    if (!readable) referencedKeys.delete(row.assetKey);
  }

  const [topLevel, originals] = await Promise.all([
    listFiles(uploadsDir),
    listFiles(path.join(uploadsDir, ORIGINALS_DIR_NAME)),
  ]);
  const uploadFiles = [
    ...topLevel.filter((f) => referencedKeys.has(uploadAssetKey(f))).map((f) => ({ rel: f })),
    ...originals
      .filter((f) => referencedKeys.has(uploadAssetKey(f)))
      .map((f) => ({ rel: path.posix.join(ORIGINALS_DIR_NAME, f) })),
  ];

  const archive: Archiver = new ZipArchive({ store: true });

  const manifest = {
    exportedAt: new Date().toISOString(),
    serverVersion: pkg.version,
    scope: 'member',
    exportedBy: { id: self.id, name: self.name, email: self.email },
    counts: {
      users: users.length,
      groups: groups.length,
      posts: posts.length,
      comments: comments.length,
      reactions: reactions.length,
      favorites: favorites.length,
      chatMessages: visibleChat.length,
      uploadFiles: uploadFiles.length,
    },
  };

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.append(serialized.users, { name: 'data/users.json' });
  archive.append(serialized.groups, { name: 'data/groups.json' });
  archive.append(serialized.posts, { name: 'data/posts.json' });
  archive.append(serialized.comments, { name: 'data/comments.json' });
  archive.append(serialized.reactions, { name: 'data/reactions.json' });
  archive.append(serialized.favorites, { name: 'data/favorites.json' });
  archive.append(serialized.chatMessages, { name: 'data/chat-messages.json' });

  for (const file of uploadFiles) {
    archive.file(path.join(uploadsDir, file.rel), { name: `uploads/${file.rel}` });
  }

  return archive;
}
