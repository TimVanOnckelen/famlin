import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { requireGroupMember } from '../plugins/auth.js';
import { getT } from '../i18n/index.js';

// Member-facing Circle routes. Deliberately READ-ONLY plus one self-service
// mutation (leaving), mirroring how routes/groups.ts is read-only and every
// group mutation lives in routes/admin.ts. Creating, editing, deleting a
// circle and managing its membership are admin operations — see the Family
// Circles block in routes/admin.ts.
export default async function circleRoutes(fastify: FastifyInstance) {
  // Circles are FULLY PRIVATE: this returns only the circles the caller is
  // actually in. A group member outside a circle gets no name, no avatar, no
  // member count — nothing that would reveal it exists. That's why there is
  // no "all circles in this group" member-facing endpoint at all.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.query as { groupId?: string };
    if (!groupId) return reply.status(400).send({ error: t('errors.groupIdRequired') });

    if (await requireGroupMember(request, reply, groupId)) return;

    const memberships = await prisma.circleMember.findMany({
      where: { userId: request.user!.id, circle: { groupId } },
      include: {
        circle: {
          include: { _count: { select: { members: true } } },
        },
      },
      orderBy: { circle: { name: 'asc' } },
    });

    return {
      items: memberships.map(({ circle }) => ({
        id: circle.id,
        groupId: circle.groupId,
        name: circle.name,
        description: circle.description,
        avatarUrl: circle.avatarUrl,
        memberCount: circle._count.members,
        createdAt: circle.createdAt,
      })),
    };
  });

  // The member list of a circle the caller belongs to. Visible to members
  // only — who is in "Adults only" is itself sensitive, which is why this is
  // gated on the caller's own membership rather than on group membership.
  fastify.get('/:circleId/members', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { circleId } = request.params as { circleId: string };

    // Membership is checked before the circle is even looked up, so a
    // non-member can't distinguish "exists but not yours" from "no such
    // circle" by timing or status code.
    const membership = await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId, userId: request.user!.id } },
    });
    if (!membership) return reply.status(404).send({ error: t('errors.circleNotFound') });

    const members = await prisma.circleMember.findMany({
      where: { circleId },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });

    return { items: members.map((m) => ({ ...m.user, joinedAt: m.joinedAt })) };
  });

  // Leaving a circle NEVER removes the user from the underlying group — the
  // circle is a narrowing layer, and dropping out of it just returns them to
  // seeing only whole-family content. Their existing posts in the circle stay
  // where they are, mirroring how removing a group member leaves their posts
  // visible to the remaining members.
  //
  // Rejoining is an admin action: a member who leaves can't re-add
  // themselves, or circle membership would be self-service in one direction
  // only and the privacy boundary would be meaningless.
  fastify.delete('/:circleId/members/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { circleId } = request.params as { circleId: string };

    const membership = await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId, userId: request.user!.id } },
    });
    if (!membership) return reply.status(404).send({ error: t('errors.circleNotFound') });

    await prisma.circleMember.delete({ where: { id: membership.id } });

    return { success: true };
  });
}
