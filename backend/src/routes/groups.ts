import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireGroupMember } from '../plugins/auth.js';
import { resolveAllowedPostTypes } from '../services/postTypes/registry.js';
import { getT } from '../i18n/index.js';

// Member-facing, read-only group endpoints. All group mutations (create/update/
// delete, add/remove members) are admin-only and live in routes/admin.ts under
// /api/admin/groups — this module intentionally does not duplicate them.
export default async function groupRoutes(fastify: FastifyInstance) {
  // Groups the current user belongs to.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request) => {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: request.user!.id },
      include: { group: true },
      orderBy: { group: { name: 'asc' } },
    });

    // allowedPostTypes goes out RESOLVED (never empty — an empty stored
    // array means "all registered types"), so clients can drive their
    // composer's type picker without knowing the registry or the
    // empty-means-all convention. The raw stored array is admin-only
    // (routes/admin.ts).
    return memberships.map((m) => ({
      ...m.group,
      allowedPostTypes: resolveAllowedPostTypes(m.group),
      joinedAt: m.joinedAt,
    }));
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: request.user!.id } },
      include: { group: true },
    });

    if (!membership) {
      return reply.status(403).send({ error: getT(request)('errors.notGroupMember') });
    }

    // Same resolved-list rule as GET / above.
    return {
      ...membership.group,
      allowedPostTypes: resolveAllowedPostTypes(membership.group),
      joinedAt: membership.joinedAt,
    };
  });

  fastify.get('/:id/members', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (await requireGroupMember(request, reply, id)) return;

    const members = await prisma.groupMember.findMany({
      where: { groupId: id },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({ ...m.user, joinedAt: m.joinedAt }));
  });
}
