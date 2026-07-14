import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireGroupMember } from '../plugins/auth.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { paginationQuerySchema } from '../types.js';
import { shapePostsWithPeople, dedupeByCrossPostId, postInclude } from '../services/posts.js';
import { getT } from '../i18n/index.js';

export default async function favoriteRoutes(fastify: FastifyInstance) {
  fastify.post('/posts/:postId/favorite', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { postId } = request.params as { postId: string };

    const post = await prisma.post.findUnique({ where: { id: postId } });

    if (!post) {
      return reply.status(404).send({ error: t('errors.postNotFound') });
    }

    if (await requireGroupMember(request, reply, post.groupId)) return;

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
          include: postInclude(request.user!.id),
        },
      },
      orderBy: { createdAt: 'desc' },
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(favorites, take);

    // Within-page only (no cursor lookup, unlike GET /api/posts) — the
    // Favorite cursor is on Favorite.id, not Post.id, so a cross-post
    // straddling a page boundary here is a rarer, lower-stakes edge case.
    const deduped = dedupeByCrossPostId(items.map(({ post }) => post));

    return {
      items: await shapePostsWithPeople(deduped, request.user!.id),
      nextCursor,
    };
  });
}
