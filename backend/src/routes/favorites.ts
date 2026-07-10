import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { isGroupMember } from '../services/groups.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { paginationQuerySchema } from '../types.js';
import { shapePostsWithPeople } from '../services/posts.js';
import { getT } from '../i18n/index.js';

export default async function favoriteRoutes(fastify: FastifyInstance) {
  fastify.post('/posts/:postId/favorite', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };

    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (!(await isGroupMember(post.groupId, request.user!.id))) {
      return reply.status(403).send({ error: t('errors.notGroupMember') });
    }

    const existing = await prisma.favorite.findUnique({
      where: { postId_userId: { postId, userId: request.user!.id } },
    });

    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return { favorited: false };
    }

    await prisma.favorite.create({
      data: {
        postId,
        userId: request.user!.id,
      },
    });

    return { favorited: true };
  });

  fastify.get('/favorites', { preHandler: [fastify.authenticate] }, async (request) => {
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const favorites = await prisma.favorite.findMany({
      where: {
        userId: request.user!.id,
        // Only surface favorites the user can still see: still a member of
        // the post's group (a removed member must never keep reading a
        // group's content via their old favorites).
        post: {
          group: { members: { some: { userId: request.user!.id } } },
        },
      },
      include: {
        post: {
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
            group: { select: { id: true, name: true } },
            _count: { select: { comments: true, likes: true } },
            likes: {
              select: { type: true, userId: true, user: { select: { id: true, name: true, avatarUrl: true } } },
              orderBy: { createdAt: 'desc' as const },
            },
            // Every row here is already this user's own favorite (the outer
            // query is scoped to userId), so this relation only exists to let
            // shapePost compute favoritedByMe the same way every other
            // post-returning endpoint does — it's always exactly one row.
            favorites: { where: { userId: request.user!.id }, select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(favorites, take);

    return {
      items: await shapePostsWithPeople(
        items.map(({ post }) => post),
        request.user!.id
      ),
      nextCursor,
    };
  });
}
