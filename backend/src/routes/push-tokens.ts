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
}
