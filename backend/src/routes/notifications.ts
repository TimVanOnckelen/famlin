import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { updateNotificationBodySchema } from '../types.js';
import { getT } from '../i18n/index.js';

export default async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: request.user!.id },
      include: {
        post: {
          select: {
            id: true,
            groupId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return notifications;
  });

  fastify.get('/unread-count', { preHandler: [fastify.authenticate] }, async (request) => {
    const count = await prisma.notification.count({
      where: { userId: request.user!.id, readAt: null },
    });

    return { count };
  });

  fastify.patch('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateNotificationBodySchema.parse(request.body);

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification || notification.userId !== request.user!.id) {
      return reply.status(404).send({ error: getT(request)('errors.notificationNotFound') });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: body.read ? new Date() : null },
    });

    return updated;
  });

  fastify.post('/mark-all-read', { preHandler: [fastify.authenticate] }, async (request) => {
    await prisma.notification.updateMany({
      where: { userId: request.user!.id, readAt: null },
      data: { readAt: new Date() },
    });

    return { success: true };
  });
}
