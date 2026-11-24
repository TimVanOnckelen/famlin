import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import {
  createChatMessageBodySchema,
  createConversationBodySchema,
  createConversationMessageBodySchema,
  paginationQuerySchema,
  setConversationEncryptionBodySchema,
  type EncryptedMessagePayloadV1,
} from '../types.js'
import { emitDomainEvent } from '../events.js'
import { requireGroupMember } from '../plugins/auth.js'
import { paginationArgs, paginate } from '../services/pagination.js'
import { shapeChatMessagesWithReadBy, shapeConversationChatMessage } from '../services/chat.js'
import { getT } from '../i18n/index.js'
import { getAllSettings } from '../services/settings.js'
import {
  uploadAssetKey,
  bindAssetsToScope,
  canBindOwnedUploadToFamily,
  claimConversationAttachment,
  deleteUploadFiles,
  isPrivateConversationUpload,
} from '../services/uploads.js'
import {
  ensureFamilyConversation,
  findAccessibleConversation,
  privateParticipantKey,
  PRIVATE_CHAT_KIND,
  usersShareFamily,
  visiblePrivateConversationCandidates,
} from '../services/chatConversations.js'
import { isUniqueConstraintViolation } from '../utils/prismaErrors.js'

const chatMessageInclude = {
  author: { select: { id: true, name: true, avatarUrl: true } },
  replyToMessage: {
    select: {
      id: true,
      conversationId: true,
      authorId: true,
      author: { select: { id: true, name: true } },
      kind: true,
      content: true,
      attachmentUrl: true,
      encryption: true,
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
    kind: string
    createdAt: Date
    encryption: string
    // Ciphertext envelope of an encrypted last message (content stays null).
    encryptedPayload?: unknown
  } | null
  unreadCount: number
  updatedAt: Date
  // Set while either participant has opted this private conversation out of
  // end-to-end encryption; null/absent otherwise (always for family chat).
  encryptionDisabledAt: Date | null
  encryptionDisabledById: string | null
}

class InvalidConversationAttachmentError extends Error {}

type EncryptedSendError = 'invalidEncryptedMessage' | 'e2eRecipientHasNoKey' | 'e2eKeyVersionStale'
const ENCRYPTED_SEND_STATUS: Record<EncryptedSendError, number> = {
  invalidEncryptedMessage: 400,
  e2eRecipientHasNoKey: 409,
  e2eKeyVersionStale: 409,
}

// Validates the (public) envelope of a v1 message against the key directory
// without ever touching ciphertext: one wrapped key per participant, each
// naming that participant's latest key version, signed with the author's
// latest version.
async function checkEncryptedEnvelope(
  payload: EncryptedMessagePayloadV1,
  authorId: string,
  participantIds: string[]
): Promise<EncryptedSendError | null> {
  const keyUserIds = payload.keys.map((key) => key.userId)
  if (
    participantIds.length !== 2 ||
    keyUserIds.length !== 2 ||
    new Set(keyUserIds).size !== 2 ||
    !participantIds.every((id) => keyUserIds.includes(id))
  ) {
    return 'invalidEncryptedMessage'
  }
  const identities = await prisma.e2eIdentity.groupBy({
    by: ['userId'],
    where: { userId: { in: participantIds } },
    _max: { version: true },
  })
  const latest = new Map(identities.map((row) => [row.userId, row._max.version ?? 0]))
  if (participantIds.some((id) => !latest.get(id))) return 'e2eRecipientHasNoKey'
  if (latest.get(authorId) !== payload.senderKeyVersion) return 'e2eKeyVersionStale'
  if (payload.keys.some((key) => latest.get(key.userId) !== key.keyVersion)) return 'e2eKeyVersionStale'
  return null
}

type LatestConversationMessage = {
  id: string
  conversationId: string
  authorId: string
  content: string | null
  attachmentUrl: string | null
  kind: string
  createdAt: Date
  encryption: string
  encryptedPayload: unknown
}

async function latestConversationMessages(conversationIds: string[]): Promise<LatestConversationMessage[]> {
  if (conversationIds.length === 0) return []
  return prisma.$queryRaw<LatestConversationMessage[]>`
    SELECT DISTINCT ON ("conversationId")
      "id", "conversationId", "authorId", "content", "attachmentUrl", "kind", "createdAt", "encryption", "encryptedPayload"
    FROM "ChatMessage"
    WHERE "conversationId" IN (${Prisma.join(conversationIds)})
    ORDER BY "conversationId", "createdAt" DESC, "id" DESC
  `
}

async function unreadConversationCounts(conversationIds: string[], userId: string): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; count: number }>>`
    SELECT message."conversationId", COUNT(*)::int AS count
    FROM "ChatMessage" message
    LEFT JOIN "ChatRead" read
      ON read."conversationId" = message."conversationId"
      AND read."userId" = ${userId}
    WHERE message."conversationId" IN (${Prisma.join(conversationIds)})
      AND message."authorId" <> ${userId}
      AND message."createdAt" > COALESCE(read."lastReadAt", TIMESTAMPTZ 'epoch')
    GROUP BY message."conversationId"
  `
  return new Map(rows.map((row) => [row.conversationId, row.count]))
}

async function accessibleConversationSummaries(userId: string): Promise<ConversationSummary[]> {
  const dmEnabled = (await getAllSettings()).directMessagesEnabled
  const [familyGroups, privateCandidates] = await Promise.all([
    prisma.group.findMany({
      where: { members: { some: { userId } }, chitchatEnabled: true },
      select: {
        id: true,
        name: true,
        members: { select: { user: { select: { id: true, name: true, avatarUrl: true } } } },
        chatConversation: { select: { id: true, kind: true, updatedAt: true, groupId: true } },
      },
    }),
    prisma.chatConversation.findMany({
      where: {
        kind: PRIVATE_CHAT_KIND,
        participants: { some: { userId } },
        // Disabled DMs are hidden, never deleted.
        ...(dmEnabled ? {} : { id: { in: [] } }),
      },
      include: {
        participants: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    }),
  ])

  const visiblePrivateIds = new Set(
    (await visiblePrivateConversationCandidates(privateCandidates, userId)).map((conversation) => conversation.id)
  )

  const familyConversations = familyGroups.flatMap((group) =>
    group.chatConversation ? [{ conversation: group.chatConversation, group }] : []
  )
  const conversations = [
    ...familyConversations,
    ...privateCandidates
      .filter((conversation) => visiblePrivateIds.has(conversation.id))
      .map((conversation) => ({ conversation, group: null })),
  ]

  const conversationIds = conversations.map(({ conversation }) => conversation.id)
  const [lastMessages, unreadCounts] = await Promise.all([
    latestConversationMessages(conversationIds),
    unreadConversationCounts(conversationIds, userId),
  ])
  const lastMessageByConversation = new Map<string, (typeof lastMessages)[number]>()
  for (const message of lastMessages) {
    if (!lastMessageByConversation.has(message.conversationId)) {
      lastMessageByConversation.set(message.conversationId, message)
    }
  }
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
              hasAttachment: (plaintext || last.encryption === 'v1') && !!last.attachmentUrl,
              kind: last.kind,
              createdAt: last.createdAt,
              encryption: last.encryption,
              ...(plaintext ? {} : { encryptedPayload: last.encryptedPayload }),
            }
          : null,
        unreadCount: unreadCounts.get(conversation.id) ?? 0,
        updatedAt: conversation.updatedAt,
        encryptionDisabledAt: privateConversation?.encryptionDisabledAt ?? null,
        encryptionDisabledById: privateConversation?.encryptionDisabledById ?? null,
      }
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id))
}

async function directMessagesAllowed(): Promise<boolean> {
  return (await getAllSettings()).directMessagesEnabled
}

export default async function chatRoutes(fastify: FastifyInstance) {
  fastify.get('/people', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!(await directMessagesAllowed()))
      return reply.status(403).send({ error: getT(request)('errors.directMessagesDisabled') })
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
    if (!(await directMessagesAllowed())) return reply.status(403).send({ error: t('errors.directMessagesDisabled') })

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
      if (conversation.kind === PRIVATE_CHAT_KIND && !(await directMessagesAllowed())) {
        return reply.status(403).send({ error: t('errors.directMessagesDisabled') })
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
      if (conversation.kind === PRIVATE_CHAT_KIND && !(await directMessagesAllowed())) {
        return reply.status(403).send({ error: t('errors.directMessagesDisabled') })
      }
      if (body.replyToMessageId) {
        const replyToMessage = await prisma.chatMessage.findFirst({
          where: { id: body.replyToMessageId, conversationId },
          select: { id: true },
        })
        if (!replyToMessage) {
          return reply.status(404).send({ error: t('errors.replyToMessageNotFound') })
        }
      }

      const encrypted = body.encryption === 'v1'
      if (encrypted) {
        if (conversation.kind !== PRIVATE_CHAT_KIND) {
          return reply.status(400).send({ error: t('errors.chatEncryptionNotSupported') })
        }
        if (!(await getAllSettings()).e2eDirectMessagesEnabled) {
          return reply.status(403).send({ error: t('errors.e2eDirectMessagesDisabled') })
        }
        const problem = await checkEncryptedEnvelope(
          body.encryptedPayload,
          request.user!.id,
          conversation.participants.map((participant) => participant.userId)
        )
        if (problem) {
          return reply.status(ENCRYPTED_SEND_STATUS[problem]).send({ error: t(`errors.${problem}`) })
        }
      }

      let message
      try {
        message = await prisma.$transaction(async (tx) => {
          // An encrypted message carries an encrypted blob; a plaintext one
          // never may (and its path can't be .bin, see types.ts).
          if (body.attachmentUrl) {
            const kind = await tx.upload.findUnique({
              where: { assetKey: uploadAssetKey(body.attachmentUrl) },
              select: { mediaKind: true },
            })
            if ((kind?.mediaKind === 'encrypted') !== encrypted) throw new InvalidConversationAttachmentError()
          }
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
            if (!(await canBindOwnedUploadToFamily(body.attachmentUrl, request.user!.id, tx))) {
              throw new InvalidConversationAttachmentError()
            }
            await bindAssetsToScope([body.attachmentUrl], { groupIds: [conversation.groupId] }, request.user!.id, tx)
          }

          const created = await tx.chatMessage.create({
            data: {
              conversationId,
              groupId: conversation.groupId,
              authorId: request.user!.id,
              kind: 'USER',
              content: 'content' in body ? body.content?.trim() : null,
              attachmentUrl: body.attachmentUrl,
              encryption: encrypted ? 'v1' : 'none',
              ...(encrypted ? { encryptedPayload: body.encryptedPayload } : {}),
              replyToMessageId: body.replyToMessageId,
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

  // Opt a private conversation out of / back into end-to-end encryption. The
  // server accepts both message kinds regardless; this flag + the system
  // message make the choice visible to both participants (never silent).
  fastify.put(
    '/conversations/:conversationId/encryption',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const t = getT(request)
      const { conversationId } = request.params as { conversationId: string }
      const body = setConversationEncryptionBodySchema.parse(request.body)
      const conversation = await findAccessibleConversation(conversationId, request.user!.id)
      if (!conversation) {
        return reply.status(404).send({ error: t('errors.chatConversationNotFound') })
      }
      if (conversation.kind === PRIVATE_CHAT_KIND && !(await directMessagesAllowed())) {
        return reply.status(403).send({ error: t('errors.directMessagesDisabled') })
      }
      if (conversation.kind !== PRIVATE_CHAT_KIND) {
        return reply.status(400).send({ error: t('errors.chatEncryptionNotSupported') })
      }

      const userId = request.user!.id
      const result = await prisma.$transaction(async (tx) => {
        // Lock the row so two concurrent toggles can't both write a message.
        await tx.$queryRaw`SELECT "id" FROM "ChatConversation" WHERE "id" = ${conversationId} FOR UPDATE`
        const current = await tx.chatConversation.findUniqueOrThrow({
          where: { id: conversationId },
          select: { encryptionDisabledAt: true, encryptionDisabledById: true },
        })
        if (!!current.encryptionDisabledAt === !body.enabled) return current
        const now = new Date()
        await tx.chatMessage.create({
          data: {
            conversationId,
            authorId: userId,
            kind: body.enabled ? 'SYSTEM_ENCRYPTION_ENABLED' : 'SYSTEM_ENCRYPTION_DISABLED',
            createdAt: now,
          },
        })
        return tx.chatConversation.update({
          where: { id: conversationId },
          data: body.enabled
            ? { encryptionDisabledAt: null, encryptionDisabledById: null, updatedAt: now }
            : { encryptionDisabledAt: now, encryptionDisabledById: userId, updatedAt: now },
          select: { encryptionDisabledAt: true, encryptionDisabledById: true },
        })
      })
      return {
        encryptionDisabledAt: result.encryptionDisabledAt,
        encryptionDisabledById: result.encryptionDisabledById,
      }
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
      if (conversation.kind === PRIVATE_CHAT_KIND && !(await directMessagesAllowed())) {
        return reply.status(403).send({ error: t('errors.directMessagesDisabled') })
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
    let message
    try {
      message = await prisma.$transaction(async (tx) => {
        if (body.attachmentUrl) {
          if (await isPrivateConversationUpload(body.attachmentUrl, tx)) {
            throw new InvalidConversationAttachmentError()
          }
          await bindAssetsToScope([body.attachmentUrl], { groupIds: [groupId] }, request.user!.id, tx)
        }
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
        await tx.chatConversation.update({
          where: { id: conversation.id },
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
      // Deleting inside a hidden private conversation is blocked for everyone
      // (admins can't delete others' private messages anyway).
      if (!(await directMessagesAllowed())) {
        return reply.status(403).send({ error: t('errors.directMessagesDisabled') })
      }
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

    const conversations = await prisma.chatConversation.findMany({
      where: { groupId: { in: groupIds } },
      select: { id: true, groupId: true },
    })
    const counts = await unreadConversationCounts(
      conversations.map((conversation) => conversation.id),
      userId
    )
    return Object.fromEntries(
      groupIds.map((groupId) => [
        groupId,
        counts.get(conversations.find((conversation) => conversation.groupId === groupId)?.id ?? '') ?? 0,
      ])
    )
  })
}
