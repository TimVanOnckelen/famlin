import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { invalidateSessionCache } from '../plugins/auth.js';
import { getAllSettings, updateSettings } from '../services/settings.js';
import { generateInviteToken, sendInviteEmail } from '../services/invites.js';
import { paginationArgs, paginate } from '../services/pagination.js';
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

// Prisma raises P2025 when an update/delete targets a row that doesn't exist —
// map it to a 404 instead of letting it fall through to a generic 500.
function isRecordNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';
}

// Returns true (and sends a 403) when the caller is not an admin. Callers MUST
// `return` when this returns true, otherwise the handler keeps executing after
// the 403 is sent and the mutation still runs.
function requireAdmin(request: any, reply: any): boolean {
  if (!request.user?.isAdmin) {
    reply.status(403).send({ error: getT(request)('errors.adminRequired') });
    return true;
  }
  return false;
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

  // Groups
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
    const group = await prisma.group.create({
      data: {
        name: body.name,
        description: body.description,
      },
    });

    return group;
  });

  fastify.patch('/groups/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const body = adminUpdateGroupBodySchema.parse(request.body);

    try {
      const group = await prisma.group.update({
        where: { id },
        data: {
          name: body.name,
          description: body.description,
        },
      });
      return group;
    } catch (err) {
      if (isRecordNotFound(err)) return reply.status(404).send({ error: 'Group not found' });
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
      if (isRecordNotFound(err)) return reply.status(404).send({ error: 'Group not found' });
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
      if (err?.code === 'P2002') {
        return reply.status(409).send({ error: 'User is already a member of this group' });
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
      if (isRecordNotFound(err)) return reply.status(404).send({ error: 'Member not found' });
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
      return reply.status(404).send({ error: 'Group not found' });
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
      if (isRecordNotFound(err)) return reply.status(404).send({ error: 'Invite not found' });
      throw err;
    }
  });

  // Content moderation: cross-group visibility into posts/comments so an
  // admin can review them without being a member of every group. Deleting
  // reuses DELETE /api/posts/:id and /api/comments/:id (already allow an
  // admin to remove any post/comment) — that removal is permanent.
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
      if (err?.code === 'P2002') {
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
  // today) support this.
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
      return await provider.listPeople();
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
}
