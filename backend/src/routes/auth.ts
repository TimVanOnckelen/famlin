import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { verifyGoogleToken, createUserToken } from '../plugins/auth.js';
import { loginBodySchema } from '../types.js';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/login', async (request, reply) => {
    try {
      const { idToken } = loginBodySchema.parse(request.body);
      const googleUser = await verifyGoogleToken(idToken);

      let user = await prisma.user.findUnique({
        where: { email: googleUser.email },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: googleUser.email,
            name: googleUser.name,
            avatarUrl: googleUser.picture,
          },
        });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            name: googleUser.name,
            avatarUrl: googleUser.picture || user.avatarUrl,
          },
        });
      }

      const token = createUserToken({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      });

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isAdmin: user.isAdmin,
          emailNotificationsEnabled: user.emailNotificationsEnabled,
        },
      };
    } catch (err: any) {
      fastify.log.error(err);
      return reply.status(401).send({ error: err.message || 'Authentication failed' });
    }
  });

  if (config.NODE_ENV === 'development') {
    fastify.post('/dev-login', async (request) => {
      const body = request.body as { email?: string };
      const email = body.email?.toLowerCase()?.trim() || 'admin@example.com';

      let user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            name: email.split('@')[0],
          },
        });
      }

      const token = createUserToken({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      });

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
          isAdmin: user.isAdmin,
          emailNotificationsEnabled: user.emailNotificationsEnabled,
        },
      };
    });
  }

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      include: {
        groupMemberships: {
          include: { group: true },
        },
      },
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      emailNotificationsEnabled: user.emailNotificationsEnabled,
      groups: user.groupMemberships.map((m) => m.group),
    };
  });

  fastify.patch('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    const body = request.body as { emailNotificationsEnabled?: boolean };

    const user = await prisma.user.update({
      where: { id: request.user!.id },
      data: body,
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      emailNotificationsEnabled: user.emailNotificationsEnabled,
    };
  });
}
