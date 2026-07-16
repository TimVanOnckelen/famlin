import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { createChatMessageBodySchema, paginationQuerySchema } from '../types.js';
import { emitDomainEvent } from '../events.js';
import { requireGroupMember } from '../plugins/auth.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { shapeChatMessagesWithReadBy } from '../services/chat.js';
import { getT } from '../i18n/index.js';

const chatMessageInclude = {
  author: { select: { id: true, name: true, avatarUrl: true } },
  replyToMessage: {
    select: {
      id: true,
      authorId: true,
      author: { select: { id: true, name: true } },
      kind: true,
      content: true,
      attachmentUrl: true,
    },
  },
};

export default async function chatRoutes(fastify: FastifyInstance) {
  fastify.get('/groups/:groupId/messages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.params as { groupId: string };
    const { cursor, take } = paginationQuerySchema.parse(request.query);

    const group = await prisma.group.findUnique({ where: { id: groupId } });

    if (!group) {
      return reply.status(404).send({ error: t('errors.groupNotFound') });
    }

    if (await requireGroupMember(request, reply, groupId)) return;

    if (!group.chitchatEnabled) {
      return reply.status(403).send({ error: t('errors.chitchatDisabled') });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { groupId },
      include: chatMessageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...paginationArgs({ cursor, take }),
    });

    const { items, nextCursor } = paginate(messages, take);

    return {
      items: await shapeChatMessagesWithReadBy(items, groupId),
      nextCursor,
    };
  });

  fastify.post('/groups/:groupId/messages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { groupId } = request.params as { groupId: string };
    const body = createChatMessageBodySchema.parse(request.body);

    const group = await prisma.group.findUnique({ where: { id: groupId } });

    if (!group) {
      return reply.status(404).send({ error: t('errors.groupNotFound') });
    }

    if (await requireGroupMember(request, reply, groupId)) return;

    if (!group.chitchatEnabled) {
      return reply.status(403).send({ error: t('errors.chitchatDisabled') });
    }

    if (body.replyToMessageId) {
      const replyToMessage = await prisma.chatMessage.findUnique({ where: { id: body.replyToMessageId } });
      if (!replyToMessage || replyToMessage.groupId !== groupId) {
        return reply.status(404).send({ error: t('errors.replyToMessageNotFound') });
      }
    }

    const message = await prisma.chatMessage.create({
      data: {
        groupId,
        authorId: request.user!.id,
        kind: 'USER',
        content: body.content?.trim(),
        attachmentUrl: body.attachmentUrl,
        replyToMessageId: body.replyToMessageId,
      },
      include: chatMessageInclude,
    });

    // Fire-and-forget, same pattern as comment.created (routes/comments.ts) —
    // the notifications subscriber decides who in the group gets told.
    emitDomainEvent('chat.created', {
      messageId: message.id,
      groupId,
      groupName: group.name,
      authorId: request.user!.id,
      authorName: message.author.name,
      content: message.content,
      hasAttachment: !!message.attachmentUrl,
      kind: message.kind,
      refPostId: message.refPostId,
    });

    const [shaped] = await shapeChatMessagesWithReadBy([message], groupId);
    return shaped;
  });

  fastify.delete('/messages/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };

    const message = await prisma.chatMessage.findUnique({ where: { id } });

    if (!message) {
      return reply.status(404).send({ error: t('errors.chatMessageNotFound') });
    }

    if (message.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.notAuthorized') });
    }

    await prisma.chatMessage.delete({ where: { id } });

    return { success: true };
  });

  fastify.post('/groups/:groupId/read', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { groupId } = request.params as { groupId: string };

    if (await requireGroupMember(request, reply, groupId)) return;

    await prisma.chatRead.upsert({
      where: { groupId_userId: { groupId, userId: request.user!.id } },
      update: { lastReadAt: new Date() },
      create: { groupId, userId: request.user!.id, lastReadAt: new Date() },
    });

    return { success: true };
  });

  fastify.get('/unread-counts', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user!.id;

    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);

    if (groupIds.length === 0) return {};

    const reads = await prisma.chatRead.findMany({
      where: { groupId: { in: groupIds }, userId },
    });
    const lastReadByGroupId = new Map(reads.map((r) => [r.groupId, r.lastReadAt]));

    // Epoch fallback for a group with no ChatRead row yet, so a user who has
    // never opened chat in that group sees every existing message as unread.
    const epoch = new Date(0);

    const counts = await Promise.all(
      groupIds.map(async (groupId) => {
        const count = await prisma.chatMessage.count({
          where: { groupId, createdAt: { gt: lastReadByGroupId.get(groupId) ?? epoch } },
        });
        return [groupId, count] as const;
      })
    );

    return Object.fromEntries(counts);
  });
}
