import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { pushTokenBodySchema } from '../types.js';

export default async function pushTokenRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const body = pushTokenBodySchema.parse(request.body);

    try {
      await prisma.pushToken.upsert({
        where: { token: body.token },
        create: {
          userId: request.user!.id,
          token: body.token,
        },
        update: {
          userId: request.user!.id,
        },
      });

      return { success: true };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Failed to register push token' });
    }
  });

  // Unregisters a device's push token — called on explicit logout so a
  // shared/handed-off device stops receiving the previous account's
  // notifications instead of waiting for Expo to notice the token is stale.
  fastify.delete('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const { token } = pushTokenBodySchema.parse(request.query);

    await prisma.pushToken.deleteMany({
      where: { token, userId: request.user!.id },
    });

    return { success: true };
  });
}
