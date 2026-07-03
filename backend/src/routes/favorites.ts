import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { isGroupMember } from '../services/groups.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { paginationQuerySchema } from '../types.js';
import { summarizeReactions } from '../services/reactions.js';
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
            likes: { select: { type: true, userId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(favorites, take);

    return {
      items: items.map(({ post }) => {
        const { _count, likes, ...rest } = post;
        const { counts, myReaction } = summarizeReactions(likes, request.user!.id);
        return {
          ...rest,
          commentCount: _count.comments,
          likeCount: _count.likes,
          likedByMe: myReaction !== null,
          myReaction,
          reactions: counts,
          favoritedByMe: true,
        };
      }),
      nextCursor,
    };
  });
}
