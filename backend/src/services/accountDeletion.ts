import { prisma } from '../db.js'
import { deleteUploadFiles } from './uploads.js'

export async function deleteUserWithPrivateConversations(userId: string): Promise<void> {
  const conversations = await prisma.chatConversation.findMany({
    where: {
      kind: 'PRIVATE',
      participants: { some: { userId } },
    },
    select: {
      id: true,
      messages: {
        where: { attachmentUrl: { not: null } },
        select: { attachmentUrl: true },
      },
      uploads: { select: { assetKey: true, mediaUrl: true } },
    },
  })
  const conversationIds = conversations.map((conversation) => conversation.id)
  const attachmentUrls = [
    ...new Set(
      conversations.flatMap((conversation) => [
        ...conversation.messages.flatMap((message) => (message.attachmentUrl ? [message.attachmentUrl] : [])),
        ...conversation.uploads.map((upload) => upload.mediaUrl ?? `/uploads/${upload.assetKey}.jpg`),
      ])
    ),
  ]

  await prisma.$transaction(async (tx) => {
    if (conversationIds.length > 0) {
      await tx.chatConversation.deleteMany({ where: { id: { in: conversationIds } } })
    }
    await tx.user.delete({ where: { id: userId } })
  })

  for (const attachmentUrl of attachmentUrls) {
    await deleteUploadFiles(attachmentUrl)
  }
}
