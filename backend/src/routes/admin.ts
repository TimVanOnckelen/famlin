import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { invalidateSessionCache, requireAdmin } from '../plugins/auth.js';
import { getAllSettings, updateSettings } from '../services/settings.js';
import { generateInviteToken, sendInviteEmail } from '../services/invites.js';
import { resendPostPush, PushNotificationError } from '../services/notifications.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { isRecordNotFound, isUniqueConstraintViolation } from '../utils/prismaErrors.js';
import {
  testImmichConnection,
} from '../services/media/immich.js';
import {
  getMediaProvider,
  mediaErrorKey,
  mediaErrorStatus,
  MediaProviderError,
} from '../services/media/registry.js';
import fsp from 'fs/promises';
import {
  createGroupBodySchema,
  groupMemberBodySchema,
  adminUpdateUserBodySchema,
  adminUpdateGroupBodySchema,
  updateServerSettingsBodySchema,
  createInviteBodySchema,
  paginationQuerySchema,
  testImmichConnectionBodySchema,
  testLocalMediaBodySchema,
  linkMediaAlbumBodySchema,
  updateMediaAlbumLinkBodySchema,
  createMediaPersonLinkBodySchema,
} from '../types.js';
import { getPostTypeHandler, listPostTypeHandlers } from '../services/postTypes/registry.js';
import { buildExportArchive } from '../services/export.js';
import { getT } from '../i18n/index.js';

// Builds the invite link's origin from the request that reached us, since
// this app has no dedicated PUBLIC_URL env var — self-hosted deployments
// vary, but the reverse proxy (or the admin's own browser, for a direct
// connection) tells us the address that actually works. request.protocol and
// request.hostname already resolve X-Forwarded-Proto/Host correctly when
// TRUST_PROXY is enabled (see app.ts), and fall back to the raw connection
// otherwise — so a directly-exposed server can't have its origin spoofed by
// a client-supplied header.
function getPublicOrigin(request: any): string {
  return `${request.protocol}://${request.hostname}`;
}

// Safety cap on GET /media/:provider/people's combined (own + cross-owner
// discovered) catalog size — this feeds an admin "map this person" picker,
// not a paginated browse UI, mirroring immich.ts's own MAX_PEOPLE cap on
// listPeople() itself.
const ADMIN_PEOPLE_CATALOG_CAP = 200;

// Fields safe to expose to admin clients. passwordHash is selected only so
// toSafeUser() below can derive `hasPassword` from it — every caller of this
// select MUST route its result through toSafeUser(), which strips the raw
// hash before the object leaves this file.
const userSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  isAdmin: true,
  passwordHash: true,
  emailOnNewPost: true,
  emailOnNewComment: true,
  emailOnNewLike: true,
  pushOnNewPost: true,
  pushOnNewComment: true,
  pushOnNewLike: true,
  pushOnChitchat: true,
  createdAt: true,
} as const;

// Strips passwordHash from a userSelect-shaped row and replaces it with
// `hasPassword` — the admin UI uses this to badge SSO-only accounts (never
// given a local password) versus password accounts.
function toSafeUser<T extends { passwordHash: string | null }>(
  user: T
): Omit<T, 'passwordHash'> & { hasPassword: boolean } {
  const { passwordHash, ...safe } = user;
  return { ...safe, hasPassword: !!passwordHash };
}

// Guards against ever leaving the app with zero admins: called before an
// update/delete that would strip isAdmin from (or delete) `userId`.
async function isLastAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!target?.isAdmin) return false;

  const adminCount = await prisma.user.count({ where: { isAdmin: true } });
  return adminCount <= 1;
}

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Dashboard overview: totals, a 14-day activity trend, and recent activity.
  fastify.get('/stats', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    // Bucketed and queried entirely in UTC (matching how `createdAt` is stored
    // and read back) so the range lines up with the day keys below regardless
    // of the server's local timezone.
    const now = new Date();
    const rangeStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13)
    );

    const [
      userCount,
      adminCount,
      groupCount,
      postCount,
      commentCount,
      likeCount,
      postsInRange,
      recentPosts,
      topGroups,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isAdmin: true } }),
      prisma.group.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.like.count(),
      prisma.post.findMany({
        where: { createdAt: { gte: rangeStart } },
        select: { createdAt: true },
      }),
      prisma.post.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          createdAt: true,
          author: { select: { name: true } },
          group: { select: { name: true } },
          _count: { select: { comments: true, likes: true } },
        },
      }),
      prisma.group.findMany({
        take: 5,
        orderBy: { posts: { _count: 'desc' } },
        select: { id: true, name: true, _count: { select: { posts: true } } },
      }),
    ]);

    const postsByDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(rangeStart);
      d.setUTCDate(d.getUTCDate() + i);
      return { date: d.toISOString().slice(0, 10), count: 0 };
    });
    const dayIndex = new Map(postsByDay.map((d, i) => [d.date, i]));
    for (const post of postsInRange) {
      const idx = dayIndex.get(post.createdAt.toISOString().slice(0, 10));
      if (idx !== undefined) postsByDay[idx].count++;
    }

    return {
      counts: {
        users: userCount,
        admins: adminCount,
        groups: groupCount,
        posts: postCount,
        comments: commentCount,
        likes: likeCount,
      },
      postsByDay,
      recentPosts: recentPosts.map(({ author, group, _count, ...post }) => ({
        ...post,
        authorName: author.name,
        groupName: group.name,
        commentCount: _count.comments,
        likeCount: _count.likes,
      })),
      topGroups: topGroups.map(({ _count, ...group }) => ({
        ...group,
        postCount: _count.posts,
      })),
    };
  });

  // Users
  fastify.get('/users', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
      select: {
        ...userSelect,
        groupMemberships: {
          select: { group: { select: { id: true, name: true } } },
          orderBy: { group: { name: 'asc' } },
        },
      },
    });

    const { items, nextCursor } = paginate(users, take);

    // Flatten memberships into a plain `groups` array for the admin UI.
    return {
      items: items.map(({ groupMemberships, ...user }) => ({
        ...toSafeUser(user),
        groups: groupMemberships.map((m) => m.group),
      })),
      nextCursor,
    };
  });

  fastify.patch('/users/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = adminUpdateUserBodySchema.parse(request.body);

    if (body.isAdmin === false && (await isLastAdmin(id))) {
      return reply.status(400).send({ error: t('errors.cannotRemoveLastAdmin') });
    }

    try {
      const user = await prisma.user.update({
        where: { id },
        data: body,
        select: userSelect,
      });
      return toSafeUser(user);
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: t('errors.userNotFound') });
      throw err;
    }
  });

  // Permanently removes the account — cascades to delete all of their posts,
  // comments, likes, favorites, and notifications too (see onDelete: Cascade
  // on Post.author/Comment.author etc. in schema.prisma). Also invalidates
  // the session cache so any token already in flight for this user id stops
  // being treated as current right away rather than waiting out its TTL.
  fastify.delete('/users/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { id } = request.params as { id: string };

    if (id === request.user!.id) {
      return reply.status(400).send({ error: t('errors.cannotDeleteYourself') });
    }
    if (await isLastAdmin(id)) {
      return reply.status(400).send({ error: t('errors.cannotRemoveLastAdmin') });
    }

    try {
      await prisma.user.delete({ where: { id } });
      invalidateSessionCache(id);
      return { success: true };
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: t('errors.userNotFound') });
      throw err;
    }
  });

  // The registered post types, for the admin UI's "allowed post types"
  // checkboxes in the group form — the registry is compile-time
  // (services/postTypes/registry.ts), so this list is static per server
  // version.
  fastify.get('/post-types', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    return { items: listPostTypeHandlers().map((handler) => ({ id: handler.id })) };
  });

  // Every id in an admin-supplied allowedPostTypes list must be a registered
  // post type — an unknown id would silently never match anything (empty ≠
  // unknown: an empty array deliberately means "all allowed"). Returns true
  // after sending the 400, mirroring requireAdmin's return-and-bail contract.
  function rejectUnknownPostTypes(allowedPostTypes: string[] | undefined, request: any, reply: any): boolean {
    if (allowedPostTypes?.some((id) => !getPostTypeHandler(id))) {
      reply.status(400).send({ error: getT(request)('errors.unknownPostType') });
      return true;
    }
    return false;
  }

  // Groups
  //
  // Admin group responses carry the RAW stored allowedPostTypes (an empty
  // array means "all allowed"), unlike the member-facing routes/groups.ts,
  // which resolve it — the admin UI needs to distinguish "all" from an
  // explicit list to render its checkboxes.
  fastify.get('/groups', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const groups = await prisma.group.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });

    return groups.map(({ _count, ...group }) => ({
      ...group,
      memberCount: _count.members,
    }));
  });

  fastify.post('/groups', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const body = createGroupBodySchema.parse(request.body);
    if (rejectUnknownPostTypes(body.allowedPostTypes, request, reply)) return;

    const group = await prisma.group.create({
      data: {
        name: body.name,
        description: body.description,
        allowedPostTypes: body.allowedPostTypes ?? [],
        chitchatEnabled: body.chitchatEnabled ?? false,
      },
    });

    return group;
  });

  fastify.patch('/groups/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = adminUpdateGroupBodySchema.parse(request.body);
    if (rejectUnknownPostTypes(body.allowedPostTypes, request, reply)) return;

    try {
      const group = await prisma.group.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description,
          // Omitted = unchanged; an explicit [] resets to "all allowed".
          ...(body.allowedPostTypes ? { allowedPostTypes: body.allowedPostTypes } : {}),
          ...(body.chitchatEnabled !== undefined ? { chitchatEnabled: body.chitchatEnabled } : {}),
        },
      });
      return group;
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: getT(request)('errors.groupNotFound') });
      throw err;
    }
  });

  fastify.delete('/groups/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };

    try {
      await prisma.group.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: getT(request)('errors.groupNotFound') });
      throw err;
    }
  });

  fastify.get('/groups/:id/members', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };

    const members = await prisma.groupMember.findMany({
      where: { groupId: id },
      include: {
        user: {
          select: userSelect,
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({ ...toSafeUser(m.user), joinedAt: m.joinedAt }));
  });

  fastify.post('/groups/:id/members', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = groupMemberBodySchema.parse(request.body);

    try {
      await prisma.groupMember.create({
        data: {
          groupId: id,
          userId: body.userId,
        },
      });
    } catch (err: any) {
      // Unique constraint: the user is already a member of this group.
      if (isUniqueConstraintViolation(err)) {
        return reply.status(409).send({ error: getT(request)('errors.userAlreadyMember') });
      }
      throw err;
    }

    return { success: true };
  });

  fastify.delete('/groups/:id/members/:userId', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id, userId } = request.params as { id: string; userId: string };

    try {
      await prisma.groupMember.delete({
        where: { groupId_userId: { groupId: id, userId } },
      });
      return { success: true };
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: getT(request)('errors.memberNotFound') });
      throw err;
    }
  });

  // Invites: single-use links that let someone join a group without an
  // existing account or an allowedEmails entry.
  fastify.get('/groups/:id/invites', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const origin = getPublicOrigin(request);

    const invites = await prisma.invite.findMany({
      where: { groupId: id },
      orderBy: { createdAt: 'desc' },
      include: { usedBy: { select: { id: true, name: true } } },
    });

    return invites.map((invite) => ({ ...invite, link: `${origin}/invite/${invite.token}` }));
  });

  fastify.post('/groups/:id/invites', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = createInviteBodySchema.parse(request.body);
    const origin = getPublicOrigin(request);

    const group = await prisma.group.findUnique({ where: { id }, select: { name: true } });
    if (!group) {
      return reply.status(404).send({ error: getT(request)('errors.groupNotFound') });
    }

    const invite = await prisma.invite.create({
      data: {
        token: generateInviteToken(),
        groupId: id,
        email: body.email?.toLowerCase(),
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000) : null,
        createdById: request.user!.id,
      },
    });

    const link = `${origin}/invite/${invite.token}`;

    if (invite.email) {
      // Best-effort: doesn't fail the request if SMTP isn't configured.
      sendInviteEmail({
        email: invite.email,
        groupName: group.name,
        inviterName: request.user!.name,
        link,
      });
    }

    return { ...invite, link };
  });

  fastify.delete('/invites/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    try {
      await prisma.invite.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: getT(request)('errors.inviteNotFound') });
      throw err;
    }
  });

  // Content moderation: cross-group visibility into posts/comments so an
  // admin can review them without being a member of every group. Deleting
  // reuses DELETE /api/posts/:id and /api/comments/:id (already allow an
  // admin to remove any post/comment) — that removal is permanent. A
  // cross-posted post's admin delete stays single-row even though an
  // author's own delete fans out to every sibling — moderation is
  // deliberately per-group (see the isAdmin branch in posts.ts's DELETE).
  fastify.get('/content/posts', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { groupId, authorId, q } = request.query as {
      groupId?: string;
      authorId?: string;
      q?: string;
    };
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const posts = await prisma.post.findMany({
      where: {
        ...(groupId ? { groupId } : {}),
        ...(authorId ? { authorId } : {}),
        ...(q ? { content: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
      include: {
        author: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    const { items, nextCursor } = paginate(posts, take);

    return {
      items: items.map(({ _count, ...post }) => ({
        ...post,
        commentCount: _count.comments,
        likeCount: _count.likes,
      })),
      nextCursor,
    };
  });

  fastify.get('/content/comments', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { groupId, authorId, q } = request.query as {
      groupId?: string;
      authorId?: string;
      q?: string;
    };
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const comments = await prisma.comment.findMany({
      where: {
        ...(groupId ? { post: { groupId } } : {}),
        ...(authorId ? { authorId } : {}),
        ...(q ? { content: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
      include: {
        author: { select: { id: true, name: true } },
        post: { select: { id: true, content: true, group: { select: { id: true, name: true } } } },
      },
    });

    return paginate(comments, take);
  });

  // Lets an admin manually resend a post's push notification (e.g. a member
  // missed it because their device was offline when it first fired) — see
  // resendPostPush() in services/notifications.ts. Push-only: doesn't touch
  // email or re-create the in-app Notification row.
  fastify.post('/content/posts/:id/retrigger-push', async (request, reply) => {
    if (requireAdmin(request, reply)) return;
    const t = getT(request);
    const { id } = request.params as { id: string };

    try {
      const result = await resendPostPush(id, request.user!.id);
      if (!result) {
        reply.status(404).send({ error: t('errors.postNotFound') });
        return;
      }
      reply.send(result);
    } catch (err) {
      if (err instanceof PushNotificationError) {
        reply.status(400).send({ error: t(`errors.${err.code}`) });
        return;
      }
      throw err;
    }
  });

  // Delivery log for push-notification send attempts — organic (post
  // created, comment created, ...) and admin-triggered ("resend push")
  // alike. One row per Expo API call, written by sendPush() in
  // services/notificationChannels/push.ts.
  fastify.get('/push-log', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { postId } = request.query as { postId?: string };
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const logs = await prisma.pushDeliveryLog.findMany({
      where: postId ? { postId } : {},
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
      include: {
        post: { select: { id: true, content: true, group: { select: { id: true, name: true } } } },
        triggeredByAdmin: { select: { id: true, name: true } },
      },
    });

    return paginate(logs, take);
  });

  // Server settings (stored in DB, editable by admin)
  fastify.get('/settings', async (request, reply) => {
    if (requireAdmin(request, reply)) return;
    return getAllSettings();
  });

  fastify.patch('/settings', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const body = updateServerSettingsBodySchema.parse(request.body);
    return updateSettings(body);
  });

  // Media integrations: each provider is one server-level connection
  // (configured above via /settings) shared by every group; below, an admin
  // links specific provider albums to specific Famlin groups so members can
  // pick photos from them (see services/media/registry.ts for the providers).
  fastify.post('/immich/test', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const body = testImmichConnectionBodySchema.parse(request.body);
    return testImmichConnection(body.serverUrl, body.apiKey);
  });

  // Validates a local-media root path before the admin saves it — the
  // equivalent of /immich/test for the local-folder provider. Path probing is
  // admin-only by definition of this route, and the saved value is what the
  // provider later trusts.
  fastify.post('/media/local/test', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const body = testLocalMediaBodySchema.parse(request.body);
    try {
      const stat = await fsp.stat(body.rootPath);
      if (!stat.isDirectory()) return { ok: false as const, error: 'not_a_directory' as const };
      await fsp.access(body.rootPath, fsp.constants.R_OK);
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: 'not_found' as const };
    }
  });

  // The admin "link an album" picker's catalog, per provider.
  fastify.get('/media/:provider/albums', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { provider: providerId } = request.params as { provider: string };
    const provider = getMediaProvider(providerId);
    if (!provider) return reply.status(404).send({ error: t('errors.mediaAlbumLinkNotFound') });

    try {
      return await provider.listAlbums();
    } catch (err) {
      if (err instanceof MediaProviderError) {
        return reply.status(mediaErrorStatus(err)).send({ error: t(mediaErrorKey(err)), code: err.code });
      }
      throw err;
    }
  });

  fastify.get('/groups/:id/media-albums', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    return prisma.mediaAlbumLink.findMany({
      where: { groupId: id },
      orderBy: { createdAt: 'desc' },
    });
  });

  fastify.post('/groups/:id/media-albums', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = linkMediaAlbumBodySchema.parse(request.body);

    // Syntactic validity per provider (Immich uuid / safe folder name) — a
    // crafted album id must never reach the provider's filesystem/API.
    const provider = getMediaProvider(body.provider)!;
    if (!provider.isValidAlbumId(body.externalAlbumId)) {
      return reply.status(400).send({ error: t('errors.validationFailed') });
    }

    try {
      const link = await prisma.mediaAlbumLink.create({
        data: {
          groupId: id,
          provider: body.provider,
          externalAlbumId: body.externalAlbumId,
          albumName: body.albumName,
        },
      });
      return link;
    } catch (err: any) {
      // Unique constraint: this album is already linked to this group.
      if (isUniqueConstraintViolation(err)) {
        return reply.status(409).send({ error: t('errors.mediaAlbumAlreadyLinked') });
      }
      throw err;
    }
  });

  fastify.delete('/media-albums/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { id } = request.params as { id: string };
    try {
      await prisma.mediaAlbumLink.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: t('errors.mediaAlbumLinkNotFound') });
      throw err;
    }
  });

  // Toggles whether/how src/jobs/newAssets.ts surfaces newly-added assets on
  // this linked album — OFF (default), MANUAL (a notification), or AUTO (a
  // real Post). The job itself resolves this per link on every run.
  fastify.patch('/media-albums/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { id } = request.params as { id: string };
    const body = updateMediaAlbumLinkBodySchema.parse(request.body);

    try {
      return await prisma.mediaAlbumLink.update({
        where: { id },
        data: { newAssetMode: body.newAssetMode },
      });
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: t('errors.mediaAlbumLinkNotFound') });
      throw err;
    }
  });

  // The admin "map a person" picker's catalog for one provider — only
  // providers that implement the optional listPeople() capability (Immich
  // today) support this. listPeople() alone only sees people the API key's
  // own account recognizes; on top of that, this also surfaces cross-owner
  // people (recognized in *other* Immich users' shared-album photos) via
  // getAlbumAssetPeople across every album linked to this provider, so an
  // admin can map someone who never appears in the key owner's own /people
  // list. Same response shape either way — the admin UI needs no changes.
  fastify.get('/media/:provider/people', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { provider: providerId } = request.params as { provider: string };
    const provider = getMediaProvider(providerId);
    if (!provider) return reply.status(404).send({ error: t('errors.mediaAlbumLinkNotFound') });
    if (!provider.listPeople) {
      return reply.status(400).send({ error: t('errors.mediaProviderLacksPeople') });
    }

    try {
      const ownPeople = await provider.listPeople();
      const byId = new Map(ownPeople.map((p) => [p.id, p]));

      if (provider.getAlbumAssetPeople) {
        const links = await prisma.mediaAlbumLink.findMany({
          where: { provider: providerId },
          select: { externalAlbumId: true },
        });
        const albumIds = [...new Set(links.map((l) => l.externalAlbumId))];

        for (const albumId of albumIds) {
          if (byId.size >= ADMIN_PEOPLE_CATALOG_CAP) break;
          try {
            const albumPeople = await provider.getAlbumAssetPeople(albumId);
            for (const people of albumPeople.values()) {
              for (const person of people) {
                if (byId.has(person.id) || byId.size >= ADMIN_PEOPLE_CATALOG_CAP) continue;
                const thumbnailDataUri = provider.getPersonThumbnail
                  ? await provider.getPersonThumbnail(person.id).catch(() => null)
                  : null;
                byId.set(person.id, { id: person.id, name: person.name, thumbnailDataUri });
              }
            }
          } catch (err) {
            // One failing album's cross-owner discovery shouldn't blank out
            // the key owner's own people (already resolved above) — log and
            // move on to the next linked album.
            console.warn(`admin media people: failed to discover album people for ${providerId}/${albumId}:`, err);
          }
        }
      }

      return [...byId.values()];
    } catch (err) {
      if (err instanceof MediaProviderError) {
        return reply.status(mediaErrorStatus(err)).send({ error: t(mediaErrorKey(err)), code: err.code });
      }
      throw err;
    }
  });

  // Every provider-person -> Famlin-user mapping, across every provider —
  // the admin UI's single management table.
  fastify.get('/media/people-links', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    return prisma.mediaPersonLink.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  });

  // Upserts on the (provider, externalPersonId) unique pair — re-mapping an
  // already-linked person (a different label/user) is a normal edit, not an
  // error.
  fastify.post('/media/people-links', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const body = createMediaPersonLinkBodySchema.parse(request.body);

    if (body.userId) {
      const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
      if (!user) return reply.status(400).send({ error: t('errors.userNotFound') });
    }

    return prisma.mediaPersonLink.upsert({
      where: { provider_externalPersonId: { provider: body.provider, externalPersonId: body.externalPersonId } },
      create: {
        provider: body.provider,
        externalPersonId: body.externalPersonId,
        label: body.label,
        userId: body.userId,
      },
      update: {
        label: body.label,
        userId: body.userId ?? null,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  });

  fastify.delete('/media/people-links/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const t = getT(request);
    const { id } = request.params as { id: string };
    try {
      await prisma.mediaPersonLink.delete({ where: { id } });
      return { success: true };
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: t('errors.mediaPersonLinkNotFound') });
      throw err;
    }
  });

  // Full data export: a zip of all family content (users sans credentials,
  // groups/members, posts, comments, reactions, favorites, chat messages) and
  // the entire uploads directory — see services/export.ts for exactly what's
  // deliberately left out (Setting, invites, tokens, notification history).
  fastify.get('/export', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const archive = await buildExportArchive();
    archive.on('error', (err) => {
      request.log.error(err, 'export archive stream error');
    });

    const filename = `famlin-export-${new Date().toISOString().slice(0, 10)}.zip`;
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${filename}"`);

    // finalize() returns a promise (archiver v8) — fire it after attaching
    // the archive to the response so bytes start streaming immediately;
    // a rejection is caught here in addition to the 'error' listener above
    // so it can never surface as an unhandled rejection.
    archive.finalize().catch((err) => {
      request.log.error(err, 'export archive finalize error');
    });
    return reply.send(archive);
  });
}
