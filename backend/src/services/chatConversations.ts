import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'

export const FAMILY_CHAT_KIND = 'FAMILY'
export const PRIVATE_CHAT_KIND = 'PRIVATE'

type DbClient = Prisma.TransactionClient | typeof prisma

export function privateParticipantKey(userIds: [string, string]): string {
  return [...userIds].sort().join(':')
}

export async function ensureFamilyConversation(groupId: string, db: DbClient = prisma) {
  return db.chatConversation.upsert({
    where: { groupId },
    update: {},
    create: { kind: FAMILY_CHAT_KIND, groupId },
  })
}

export async function usersShareFamily(userA: string, userB: string, db: DbClient = prisma): Promise<boolean> {
  const shared = await db.groupMember.findFirst({
    where: {
      userId: userA,
      group: { members: { some: { userId: userB } } },
    },
    select: { id: true },
  })
  return !!shared
}

export async function findAccessibleConversation(conversationId: string, userId: string, db: DbClient = prisma) {
  const conversation = await db.chatConversation.findUnique({
    where: { id: conversationId },
    include: {
      group: { select: { id: true, name: true, chitchatEnabled: true } },
      participants: {
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })
  if (!conversation) return null

  if (conversation.kind === FAMILY_CHAT_KIND) {
    if (!conversation.groupId || !conversation.group?.chitchatEnabled) return null
    const member = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId: conversation.groupId, userId } },
      select: { id: true },
    })
    return member ? conversation : null
  }

  if (conversation.kind !== PRIVATE_CHAT_KIND) return null
  if (
    conversation.participants.length !== 2 ||
    !conversation.participants.some((participant) => participant.userId === userId)
  ) {
    return null
  }

  const other = conversation.participants.find((participant) => participant.userId !== userId)
  if (!other || !(await usersShareFamily(userId, other.userId, db))) return null
  return conversation
}

export async function canReadChatConversationUpload(conversationId: string, userId: string): Promise<boolean> {
  return !!(await findAccessibleConversation(conversationId, userId))
}
