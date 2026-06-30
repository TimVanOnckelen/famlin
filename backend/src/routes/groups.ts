import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createGroupBodySchema, groupMemberBodySchema } from '../types.js';

function requireAdmin(request: any, reply: any) {
  if (!request.user?.isAdmin) {
    return reply.status(403).send({ error: 'Admin required' });
  }
}

export default async function groupRoutes(fastify: FastifyInstance) {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: request.user!.id },
      include: { group: true },
      orderBy: { group: { name: 'asc' } },
    });

    return memberships.map((m) => ({
      ...m.group,
      joinedAt: m.joinedAt,
    }));
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    requireAdmin(request, reply);

    const body = createGroupBodySchema.parse(request.body);
    const group = await prisma.group.create({
      data: {
        name: body.name,
        description: body.description,
      },
    });

    return group;
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: request.user!.id } },
      include: { group: true },
    });

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this group' });
    }

    return {
      ...membership.group,
      joinedAt: membership.joinedAt,
    };
  });

  fastify.post('/:id/members', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    requireAdmin(request, reply);

    const { id } = request.params as { id: string };
    const body = groupMemberBodySchema.parse(request.body);

    const membership = await prisma.groupMember.create({
      data: {
        groupId: id,
        userId: body.userId,
      },
    });

    return membership;
  });

  fastify.delete('/:id/members/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    requireAdmin(request, reply);

    const { id, userId } = request.params as { id: string; userId: string };

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId: id, userId } },
    });

    return { success: true };
  });

  fastify.get('/:id/members', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: request.user!.id } },
    });

    if (!membership) {
      return reply.status(403).send({ error: 'Not a member of this group' });
    }

    const members = await prisma.groupMember.findMany({
      where: { groupId: id },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => m.user);
  });
}
