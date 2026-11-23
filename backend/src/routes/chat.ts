import type { FastifyInstance } from 'fastify'
import { prisma } from '../db.js'
import {
  createChatMessageBodySchema,
  createConversationBodySchema,
  createConversationMessageBodySchema,
  paginationQuerySchema,
} from '../types.js'
import { emitDomainEvent } from '../events.js'
import { requireGroupMember } from '../plugins/auth.js'
import { paginationArgs, paginate } from '../services/pagination.js'
import { shapeChatMessagesWithReadBy, shapeConversationChatMessage } from '../services/chat.js'
import { getT } from '../i18n/index.js'
import { bindAssetsToScope, claimConversationAttachment, deleteUploadFiles } from '../services/uploads.js'
import {
  ensureFamilyConversation,
  findAccessibleConversation,
  privateParticipantKey,
  PRIVATE_CHAT_KIND,
  usersShareFamily,
} from '../services/chatConversations.js'
import { isUniqueConstraintViolation } from '../utils/prismaErrors.js'

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
}

type ConversationSummary = {
  id: string
  kind: string
  group?: { id: string; name: string }
  participants: Array<{ id: string; name: string; avatarUrl: string | null }>
  lastMessage: {
    id: string
    authorId: string
    content: string | null
    hasAttachment: boolean
    createdAt: Date
    encryption: string
  } | null
  unreadCount: number
  updatedAt: Date
}

class InvalidConversationAttachmentError extends Error {}

async function accessibleConversationSummaries(userId: string): Promise<ConversationSummary[]> {
  const [familyGroups, privateCandidates] = await Promise.all([
    prisma.group.findMany({
      where: { members: { some: { userId } }, chitchatEnabled: true },
      select: {
        id: true,
        name: true,
        members: { select: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      },
    }),
    prisma.chatConversation.findMany({
      where: {
        kind: PRIVATE_CHAT_KIND,
        participants: { some: { userId } },
      },
      include: {
        participants: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    }),
  ])

  const visiblePrivateIds = new Set<string>()
  for (const conversation of privateCandidates) {
    if (conversation.participants.length !== 2) continue
    const other = conversation.participants.find((participant) => participant.userId !== userId)
    if (other && (await usersShareFamily(userId, other.userId))) visiblePrivateIds.add(conversation.id)
  }

  const familyConversations = await Promise.all(
    familyGroups.map(async (group) => {
      const conversation = await ensureFamilyConversation(group.id)
      return { conversation, group }
    })
  )
  const conversations = [
    ...familyConversations,
    ...privateCandidates
      .filter((conversation) => visiblePrivateIds.has(conversation.id))
      .map((conversation) => ({ conversation, group: null })),
  ]

  const conversationIds = conversations.map(({ conversation }) => conversation.id)
  const [lastMessages, reads] = await Promise.all([
    conversationIds.length === 0
      ? Promise.resolve([])
      : prisma.chatMessage.findMany({
          where: { conversationId: { in: conversationIds } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
    conversationIds.length === 0
      ? Promise.resolve([])
      : prisma.chatRead.findMany({
          where: { conversationId: { in: conversationIds }, userId },
          select: { conversationId: true, lastReadAt: true },
        }),
  ])
  const lastMessageByConversation = new Map<string, (typeof lastMessages)[number]>()
  for (const message of lastMessages) {
    if (!lastMessageByConversation.has(message.conversationId)) {
      lastMessageByConversation.set(message.conversationId, message)
    }
  }
  const lastReadByConversation = new Map(reads.map((read) => [read.conversationId, read.lastReadAt]))
  const epoch = new Date(0)
  const unreadCounts = new Map(
    await Promise.all(
      conversationIds.map(async (conversationId) => {
        const count = await prisma.chatMessage.count({
          where: {
            conversationId,
            createdAt: { gt: lastReadByConversation.get(conversationId) ?? epoch },
          },
        })
        return [conversationId, count] as const
      })
    )
  )

  return conversations
    .map(({ conversation, group }): ConversationSummary => {
      const privateConversation =
        conversation.kind === PRIVATE_CHAT_KIND
          ? privateCandidates.find((candidate) => candidate.id === conversation.id)
          : null
      const participants = group
        ? group.members.map((member) => member.user)
        : (privateConversation?.participants.map((participant) => participant.user) ?? [])
      const last = lastMessageByConversation.get(conversation.id)
      const plaintext = last?.encryption === 'none'

      return {
        id: conversation.id,
        kind: conversation.kind,
        ...(group ? { group: { id: group.id, name: group.name } } : {}),
        participants,
        lastMessage: last
          ? {
              id: last.id,
              authorId: last.authorId,
              content: plaintext ? last.content : null,
              hasAttachment: plaintext && !!last.attachmentUrl,
              createdAt: last.createdAt,
              encryption: last.encryption,
            }
          : null,
        unreadCount: unreadCounts.get(conversation.id) ?? 0,
        updatedAt: conversation.updatedAt,
      }
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))
}

export default async function chatRoutes(fastify: FastifyInstance) {
  fastify.get('/people', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user!.id
    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    })
    const groupIds = memberships.map((membership) => membership.groupId)

    if (groupIds.length === 0) return { items: [] }

    const items = await prisma.user.findMany({
      where: {
        id: { not: userId },
        groupMemberships: { some: { groupId: { in: groupIds } } },
      },
      select: { id: true, name: true, avatarUrl: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })

    return { items }
  })

  fastify.post('/conversations', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const body = createConversationBodySchema.parse(request.body)
    const [participantId] = body.participantIds
    const userId = request.user!.id

    if (participantId === userId) {
      return reply.status(400).send({ error: t('errors.cannotMessageYourself') })
    }
    if (!(await usersShareFamily(userId, participantId))) {
      return reply.status(404).send({ error: t('errors.chatConversationNotFound') })
    }

    const participantKey = privateParticipantKey([userId, participantId])
    const conversationInclude = {
      participants: {
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { joinedAt: 'asc' as const },
      },
    }
    let conversation = await prisma.chatConversation.findUnique({
      where: { participantKey },
      include: conversationInclude,
    })
    if (!conversation) {
      try {
        conversation = await prisma.chatConversation.create({
          data: {
            kind: PRIVATE_CHAT_KIND,
            participantKey,
            createdById: userId,
            participants: { create: [{ userId }, { userId: participantId }] },
          },
          include: conversationInclude,
        })
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) throw error
        conversation = await prisma.chatConversation.findUnique({
          where: { participantKey },
          include: conversationInclude,
        })
        if (!conversation) throw error
      }
    }

    const summary = (await accessibleConversationSummaries(userId)).find(
      (candidate) => candidate.id === conversation.id
    )
    if (!summary) {
      return reply.status(404).send({ error: t('errors.chatConversationNotFound') })
    }
    return summary
  })

  fastify.get('/conversations', { preHandler: [fastify.authenticate] }, async (request) => ({
    items: await accessibleConversationSummaries(request.user!.id),
  }))

  fastify.get('/conversations/unread', { preHandler: [fastify.authenticate] }, async (request) => {
    const items = await accessibleConversationSummaries(request.user!.id)
    return {
      total: items.reduce((total, conversation) => total + conversation.unreadCount, 0),
      byConversation: Object.fromEntries(items.map((conversation) => [conversation.id, conversation.unreadCount])),
    }
  })

  fastify.get(
    '/conversations/:conversationId/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const t = getT(request)
      const { conversationId } = request.params as { conversationId: string }
      const { cursor, take } = paginationQuerySchema.parse(request.query)
      const conversation = await findAccessibleConversation(conversationId, request.user!.id)
      if (!conversation) {
        return reply.status(404).send({ error: t('errors.chatConversationNotFound') })
      }

      const messages = await prisma.chatMessage.findMany({
        where: { conversationId },
        include: chatMessageInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paginationArgs({ cursor, take }),
      })
      const { items, nextCursor } = paginate(messages, take)

      if (conversation.groupId) {
        const shaped = await shapeChatMessagesWithReadBy(items, conversation.groupId)
        return {
          items: shaped.map((message, index) => ({
            ...message,
            conversationId: items[index].conversationId,
            encryption: items[index].encryption,
            encryptedPayload: items[index].encryptedPayload,
          })),
          nextCursor,
        }
      }

      return { items: items.map(shapeConversationChatMessage), nextCursor }
    }
  )

  fastify.post(
    '/conversations/:conversationId/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const t = getT(request)
      const { conversationId } = request.params as { conversationId: string }
      const body = createConversationMessageBodySchema.parse(request.body)
      const conversation = await findAccessibleConversation(conversationId, request.user!.id)
      if (!conversation) {
        return reply.status(404).send({ error: t('errors.chatConversationNotFound') })
      }

      let message
      try {
        message = await prisma.$transaction(async (tx) => {
          if (conversation.kind === PRIVATE_CHAT_KIND && body.attachmentUrl) {
            const claimed = await claimConversationAttachment(
              body.attachmentUrl,
              request.user!.id,
              conversationId,
              conversation.participants.map((participant) => participant.userId),
              tx
            )
            if (!claimed) throw new InvalidConversationAttachmentError()
          } else if (body.attachmentUrl && conversation.groupId) {
            await bindAssetsToScope([body.attachmentUrl], { groupIds: [conversation.groupId] }, request.user!.id, tx)
          }

          const created = await tx.chatMessage.create({
            data: {
              conversationId,
              groupId: conversation.groupId,
              authorId: request.user!.id,
              kind: 'USER',
              content: body.content?.trim(),
              attachmentUrl: body.attachmentUrl,
            },
            include: chatMessageInclude,
          })
          await tx.chatConversation.update({
            where: { id: conversationId },
            data: { updatedAt: created.createdAt },
          })
          return created
        })
      } catch (error) {
        if (error instanceof InvalidConversationAttachmentError) {
          return reply.status(400).send({ error: t('errors.invalidChatAttachment') })
        }
        throw error
      }

      emitDomainEvent('chat.created', {
        conversationId,
        conversationKind: conversation.kind,
        messageId: message.id,
        groupId: conversation.groupId,
        groupName: conversation.group?.name ?? null,
        participantIds: conversation.participants.map((participant) => participant.userId),
        authorId: request.user!.id,
        authorName: message.author.name,
        content: message.content,
        hasAttachment: !!message.attachmentUrl,
        kind: message.kind,
        refPostId: message.refPostId,
      })

      if (conversation.groupId) {
        const [shaped] = await shapeChatMessagesWithReadBy([message], conversation.groupId)
        return {
          ...shaped,
          conversationId: message.conversationId,
          encryption: message.encryption,
          encryptedPayload: message.encryptedPayload,
        }
      }
      return shapeConversationChatMessage(message)
    }
  )

  fastify.post(
    '/conversations/:conversationId/read',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const t = getT(request)
      const { conversationId } = request.params as { conversationId: string }
      const conversation = await findAccessibleConversation(conversationId, request.user!.id)
      if (!conversation) {
        return reply.status(404).send({ error: t('errors.chatConversationNotFound') })
      }

      await prisma.chatRead.upsert({
        where: { conversationId_userId: { conversationId, userId: request.user!.id } },
        update: { groupId: conversation.groupId, lastReadAt: new Date() },
        create: {
          conversationId,
          groupId: conversation.groupId,
          userId: request.user!.id,
          lastReadAt: new Date(),
        },
      })
      return { success: true }
    }
  )

  fastify.get('/groups/:groupId/messages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const { groupId } = request.params as { groupId: string }
    const { cursor, take } = paginationQuerySchema.parse(request.query)
    const group = await prisma.group.findUnique({ where: { id: groupId } })

    if (!group) return reply.status(404).send({ error: t('errors.groupNotFound') })
    if (await requireGroupMember(request, reply, groupId)) return
    if (!group.chitchatEnabled) return reply.status(403).send({ error: t('errors.chitchatDisabled') })

    const messages = await prisma.chatMessage.findMany({
      where: { groupId },
      include: chatMessageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...paginationArgs({ cursor, take }),
    })
    const { items, nextCursor } = paginate(messages, take)

    return { items: await shapeChatMessagesWithReadBy(items, groupId), nextCursor }
  })

  fastify.post('/groups/:groupId/messages', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const { groupId } = request.params as { groupId: string }
    const body = createChatMessageBodySchema.parse(request.body)
    const group = await prisma.group.findUnique({ where: { id: groupId } })

    if (!group) return reply.status(404).send({ error: t('errors.groupNotFound') })
    if (await requireGroupMember(request, reply, groupId)) return
    if (!group.chitchatEnabled) return reply.status(403).send({ error: t('errors.chitchatDisabled') })

    if (body.replyToMessageId) {
      const replyToMessage = await prisma.chatMessage.findUnique({ where: { id: body.replyToMessageId } })
      if (!replyToMessage || replyToMessage.groupId !== groupId) {
        return reply.status(404).send({ error: t('errors.replyToMessageNotFound') })
      }
    }

    const conversation = await ensureFamilyConversation(groupId)
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          conversationId: conversation.id,
          groupId,
          authorId: request.user!.id,
          kind: 'USER',
          content: body.content?.trim(),
          attachmentUrl: body.attachmentUrl,
          replyToMessageId: body.replyToMessageId,
        },
        include: chatMessageInclude,
      })
      if (body.attachmentUrl) {
        await bindAssetsToScope([body.attachmentUrl], { groupIds: [groupId] }, request.user!.id, tx)
      }
      await tx.chatConversation.update({ where: { id: conversation.id }, data: { updatedAt: created.createdAt } })
      return created
    })

    emitDomainEvent('chat.created', {
      conversationId: conversation.id,
      conversationKind: conversation.kind,
      messageId: message.id,
      groupId,
      groupName: group.name,
      participantIds: [],
      authorId: request.user!.id,
      authorName: message.author.name,
      content: message.content,
      hasAttachment: !!message.attachmentUrl,
      kind: message.kind,
      refPostId: message.refPostId,
    })

    const [shaped] = await shapeChatMessagesWithReadBy([message], groupId)
    return shaped
  })

  fastify.delete('/messages/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request)
    const { id } = request.params as { id: string }
    const message = await prisma.chatMessage.findUnique({
      where: { id },
      include: { conversation: true },
    })
    if (!message) return reply.status(404).send({ error: t('errors.chatMessageNotFound') })

    if (message.conversation.kind === PRIVATE_CHAT_KIND) {
      const conversation = await findAccessibleConversation(message.conversationId, request.user!.id)
      if (!conversation) return reply.status(404).send({ error: t('errors.chatMessageNotFound') })
      if (message.authorId !== request.user!.id) {
        return reply.status(403).send({ error: t('errors.notAuthorized') })
      }
    } else if (message.authorId !== request.user!.id && !request.user!.isAdmin) {
      return reply.status(403).send({ error: t('errors.notAuthorized') })
    }

    await prisma.chatMessage.delete({ where: { id } })
    if (message.conversation.kind === PRIVATE_CHAT_KIND && message.attachmentUrl) {
      const remaining = await prisma.chatMessage.count({ where: { attachmentUrl: message.attachmentUrl } })
      if (remaining === 0) await deleteUploadFiles(message.attachmentUrl)
    }
    return { success: true }
  })

  fastify.post('/groups/:groupId/read', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { groupId } = request.params as { groupId: string }
    if (await requireGroupMember(request, reply, groupId)) return

    const conversation = await ensureFamilyConversation(groupId)
    await prisma.chatRead.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: request.user!.id } },
      update: { groupId, lastReadAt: new Date() },
      create: { conversationId: conversation.id, groupId, userId: request.user!.id, lastReadAt: new Date() },
    })
    return { success: true }
  })

  fastify.get('/unread-counts', { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user!.id
    const memberships = await prisma.groupMember.findMany({ where: { userId }, select: { groupId: true } })
    const groupIds = memberships.map((membership) => membership.groupId)
    if (groupIds.length === 0) return {}

    const reads = await prisma.chatRead.findMany({ where: { groupId: { in: groupIds }, userId } })
    const lastReadByGroupId = new Map(reads.map((read) => [read.groupId, read.lastReadAt]))
    const epoch = new Date(0)
    const counts = await Promise.all(
      groupIds.map(async (groupId) => {
        const count = await prisma.chatMessage.count({
          where: { groupId, createdAt: { gt: lastReadByGroupId.get(groupId) ?? epoch } },
        })
        return [groupId, count] as const
      })
    )
    return Object.fromEntries(counts)
  })
}
