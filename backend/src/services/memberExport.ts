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
//  - Other members' Device rows: only the caller's own diagnostics are included.
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
import { ZipArchive, type Archiver } from 'archiver'
import { prisma } from '../db.js'
import { getStorage } from './storage/registry.js'
import { appendStoredObject } from './storage/archive.js'
import { getUserCircleIds, visiblePostsWhere } from './circles.js'
import { visibleWikiPagesWhere } from './wiki.js'
import { uploadAssetKey, isUploadRowReadable } from './uploads.js'
import { redactGiftListTypeData } from './giftLists.js'
import pkg from '../../package.json' with { type: 'json' }

// Matches every /uploads/<file> path embedded anywhere in the exported rows —
// uploadedAssetUrls, comment attachments/assetUrl, trip/album typeData cover
// photos, check-in metadata photoUrls, chat attachments, avatars — so a new
// field holding an upload path is picked up without touching this file.
const UPLOAD_PATH_RE = /\/uploads\/([A-Za-z0-9._-]+)/g

export function collectUploadKeys(serialized: string): Set<string> {
  const keys = new Set<string>()
  for (const match of serialized.matchAll(UPLOAD_PATH_RE)) {
    keys.add(uploadAssetKey(match[1]))
  }
  return keys
}

export async function buildMemberExportArchive(userId: string): Promise<Archiver> {
  const [memberships, circleIds] = await Promise.all([
    prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } }),
    getUserCircleIds(userId),
  ])
  const groupIds = memberships.map((m) => m.groupId)

  const [groups, posts, self, devices] = await Promise.all([
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
    prisma.device.findMany({
      where: { userId },
      orderBy: { installId: 'asc' },
      select: {
        installId: true,
        platform: true,
        osVersion: true,
        appVersion: true,
        appBuild: true,
        pushPermission: true,
      },
    }),
  ])

  const postIds = posts.map((p) => p.id)
  const visiblePostIds = new Set(postIds)
  const chatGroupIds = groups.filter((g) => g.chitchatEnabled).map((g) => g.id)
  const otherUserIds = [...new Set(groups.flatMap((g) => g.members.map((m) => m.userId)))].filter((id) => id !== userId)

  const [comments, favorites, chatMessages, otherUsers, giftListItems, giftDrawAssignments, wikiPages] =
    await Promise.all([
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
      // Every wishlist on the gift lists the caller can see (posts above are
      // already narrowed to their hidden circles) — as in the app.
      prisma.giftListItem.findMany({ where: { postId: { in: postIds } }, orderBy: { position: 'asc' } }),
      // Secret Santa: ONLY the caller's own assignment, never anyone else's.
      prisma.giftDrawAssignment.findMany({ where: { giverId: userId, postId: { in: postIds } } }),
      // Family Wiki pages the caller can read in the app — same circle rule.
      prisma.wikiPage.findMany({ where: visibleWikiPagesWhere(groupIds, circleIds), orderBy: { createdAt: 'asc' } }),
    ])

  const commentIds = comments.map((c) => c.id)
  const reactions = await prisma.like.findMany({
    where: { OR: [{ postId: { in: postIds } }, { commentId: { in: commentIds } }] },
  })
  const visibleChat = chatMessages.filter((m) => !m.refPostId || visiblePostIds.has(m.refPostId))
  const users = [self, ...otherUsers]

  const data = {
    users,
    devices,
    groups,
    // A gift list's exclusions are the starter's configuration (and hint at
    // pairings), so they're stripped exactly as the app strips them.
    posts: posts.map((post) => redactGiftListTypeData(post, userId)),
    comments,
    reactions,
    favorites,
    chatMessages: visibleChat,
    giftListItems,
    giftDrawAssignments,
    wikiPages,
  }
  const serialized = Object.fromEntries(
    Object.entries(data).map(([key, rows]) => [key, JSON.stringify(rows, null, 2)])
  ) as Record<keyof typeof data, string>

  // Upload files: only what the rows above reference, never the directory.
  // The keys come from a regex over every serialized row, free text included,
  // so a member can name any upload path (another family's photo) in their
  // own post or comment — each is filtered through the same rule /uploads/*
  // enforces (isUploadRowReadable), against memberships loaded above.
  const referencedKeys = collectUploadKeys(Object.values(serialized).join('\n'))
  const scope = { uploaderId: true, circleId: true, bound: true, groupIds: true, serverWide: true } as const
  const uploadRows = await prisma.upload.findMany({
    where: { assetKey: { in: [...referencedKeys] } },
    select: { assetKey: true, motionAssetKey: true, ...scope, livePhoto: { select: scope } },
  })
  const myGroups = new Set(groupIds)
  const myCircles = new Set(circleIds)
  const viewer = {
    inCircle: (circleId: string) => myCircles.has(circleId),
    inAnyGroup: (ids: string[]) => ids.some((id) => myGroups.has(id)),
  }
  for (const row of uploadRows) {
    // A Live Photo's motion clip is readable exactly when its photo is.
    if (!(await isUploadRowReadable(row.livePhoto ?? row, userId, viewer))) referencedKeys.delete(row.assetKey)
    else if (row.motionAssetKey) referencedKeys.add(row.motionAssetKey)
  }

  const uploadFiles: { rel: string }[] = []
  for await (const file of getStorage().list()) {
    if ((file.key.includes('/') && !file.key.startsWith('originals/')) || !referencedKeys.has(uploadAssetKey(file.key)))
      continue
    uploadFiles.push({ rel: file.key })
  }

  const archive: Archiver = new ZipArchive({ store: true })

  const manifest = {
    exportedAt: new Date().toISOString(),
    serverVersion: pkg.version,
    scope: 'member',
    exportedBy: { id: self.id, name: self.name, email: self.email },
    counts: {
      users: users.length,
      devices: devices.length,
      groups: groups.length,
      posts: posts.length,
      comments: comments.length,
      reactions: reactions.length,
      favorites: favorites.length,
      chatMessages: visibleChat.length,
      giftListItems: giftListItems.length,
      giftDrawAssignments: giftDrawAssignments.length,
      wikiPages: wikiPages.length,
      uploadFiles: uploadFiles.length,
    },
  }

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' })
  archive.append(serialized.users, { name: 'data/users.json' })
  archive.append(serialized.devices, { name: 'data/devices.json' })
  archive.append(serialized.groups, { name: 'data/groups.json' })
  archive.append(serialized.posts, { name: 'data/posts.json' })
  archive.append(serialized.comments, { name: 'data/comments.json' })
  archive.append(serialized.reactions, { name: 'data/reactions.json' })
  archive.append(serialized.favorites, { name: 'data/favorites.json' })
  archive.append(serialized.chatMessages, { name: 'data/chat-messages.json' })
  archive.append(serialized.giftListItems, { name: 'data/gift-list-items.json' })
  archive.append(serialized.giftDrawAssignments, { name: 'data/gift-draw-assignments.json' })
  archive.append(serialized.wikiPages, { name: 'data/wiki-pages.json' })

  for (const file of uploadFiles) {
    appendStoredObject(archive, file.rel)
  }

  return archive
}
