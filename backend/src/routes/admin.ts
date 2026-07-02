import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import {
  createGroupBodySchema,
  groupMemberBodySchema,
  adminUpdateUserBodySchema,
  adminUpdateGroupBodySchema,
  updateServerSettingsBodySchema,
  createInviteBodySchema,
  paginationQuerySchema,
} from '../types.js';
import { getAllSettings, updateSettings } from '../services/settings.js';
import { generateInviteToken, sendInviteEmail } from '../services/invites.js';
import { paginationArgs, paginate } from '../services/pagination.js';
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

// Fields safe to expose to admin clients — never includes passwordHash.
const userSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  isAdmin: true,
  emailOnNewPost: true,
  emailOnNewComment: true,
  emailOnNewLike: true,
  pushOnNewPost: true,
  pushOnNewComment: true,
  pushOnNewLike: true,
  createdAt: true,
  deletedAt: true,
} as const;

// Guards against ever leaving the app with zero admins: called before an
// update/delete that would strip isAdmin from (or deactivate) `userId`.
async function isLastAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!target?.isAdmin) return false;

  const adminCount = await prisma.user.count({ where: { isAdmin: true, deletedAt: null } });
  return adminCount <= 1;
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

    const { includeDeleted } = request.query as { includeDeleted?: string };
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const users = await prisma.user.findMany({
      where: includeDeleted === 'true' ? {} : { deletedAt: null },
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
        ...user,
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

    const user = await prisma.user.update({
      where: { id },
      data: body,
      select: userSelect,
    });

    return user;
  });

  // Soft-deletes (deactivates) the account rather than removing the row, so
  // their existing posts/comments/photos stay intact for the rest of the
  // family — mirrors the Post/Comment soft-delete convention. Also bumps
  // tokenVersion so any session already open on their device stops working
  // immediately instead of at natural token expiry.
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

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), tokenVersion: { increment: 1 } },
    });

    return { success: true };
  });

  fastify.post('/users/:id/restore', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const user = await prisma.user.update({
      where: { id },
      data: { deletedAt: null },
      select: userSelect,
    });

    return user;
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

    const group = await prisma.group.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
      },
    });

    return group;
  });

  fastify.delete('/groups/:id', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };

    await prisma.group.delete({ where: { id } });

    return { success: true };
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

    return members.map((m) => ({ ...m.user, joinedAt: m.joinedAt }));
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

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId: id, userId } },
    });

    return { success: true };
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
    await prisma.invite.delete({ where: { id } });

    return { success: true };
  });

  // Content moderation: cross-group visibility into posts/comments so an
  // admin can review them without being a member of every group. Deleting
  // reuses DELETE /api/posts/:id and /api/comments/:id (already allow an
  // admin to remove any post/comment); these routes add the matching
  // restore action since those deletes are soft.
  fastify.get('/content/posts', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { groupId, includeDeleted } = request.query as { groupId?: string; includeDeleted?: string };
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const posts = await prisma.post.findMany({
      where: {
        ...(groupId ? { groupId } : {}),
        ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
      include: {
        author: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        deletedBy: { select: { id: true, name: true } },
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

    const { groupId, includeDeleted } = request.query as { groupId?: string; includeDeleted?: string };
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const comments = await prisma.comment.findMany({
      where: {
        ...(groupId ? { post: { groupId } } : {}),
        ...(includeDeleted === 'true' ? {} : { deletedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
      include: {
        author: { select: { id: true, name: true } },
        deletedBy: { select: { id: true, name: true } },
        post: { select: { id: true, content: true, group: { select: { id: true, name: true } } } },
      },
    });

    return paginate(comments, take);
  });

  fastify.post('/content/posts/:id/restore', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) {
      return reply.status(404).send({ error: 'Post not found' });
    }

    return prisma.post.update({
      where: { id },
      data: { deletedAt: null, deletedById: null },
    });
  });

  fastify.post('/content/comments/:id/restore', async (request, reply) => {
    if (requireAdmin(request, reply)) return;

    const { id } = request.params as { id: string };
    const comment = await prisma.comment.findUnique({ where: { id } });
    if (!comment) {
      return reply.status(404).send({ error: 'Comment not found' });
    }

    return prisma.comment.update({
      where: { id },
      data: { deletedAt: null, deletedById: null },
    });
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
}
