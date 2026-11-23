import { prisma } from '../db.js'
import { excerptText } from './notifications.js'

// Shared response shape for a chat message — mirrors services/comments.ts
// shapeComment (a similarly flat shape, no cross-posting/type-handler
// complexity to worry about).

interface ChatMessageRow {
  id: string
  conversationId: string
  groupId: string | null
  authorId: string
  author: { id: string; name: string; avatarUrl: string | null }
  kind: string
  content: string | null
  attachmentUrl: string | null
  encryption: string
  encryptedPayload: unknown
  refPostId: string | null
  replyToMessageId: string | null
  replyToMessage: {
    id: string
    conversationId: string
    authorId: string
    author: { id: string; name: string }
    kind: string
    content: string | null
    attachmentUrl: string | null
  } | null
  createdAt: Date
  editedAt: Date | null
}

interface ChatUser {
  id: string
  name: string
  avatarUrl: string | null
}

function shapeReplyTo(message: ChatMessageRow) {
  return message.replyToMessage?.conversationId === message.conversationId
    ? {
        id: message.replyToMessage.id,
        authorId: message.replyToMessage.authorId,
        authorName: message.replyToMessage.author.name,
        kind: message.replyToMessage.kind,
        // Preserve null for attachment-only messages so clients can render
        // the correct attachment fallback.
        content: message.replyToMessage.content?.trim() ? excerptText(message.replyToMessage.content) : null,
        attachmentUrl: message.replyToMessage.attachmentUrl,
      }
    : null
}

export function shapeChatMessage(message: ChatMessageRow, readBy: ChatUser[]) {
  return {
    id: message.id,
    groupId: message.groupId,
    authorId: message.authorId,
    author: message.author,
    kind: message.kind,
    content: message.content,
    attachmentUrl: message.attachmentUrl,
    refPostId: message.refPostId,
    replyToMessageId: message.replyToMessageId,
    replyTo: shapeReplyTo(message),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    readBy,
  }
}

export function shapeConversationChatMessage(message: ChatMessageRow) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    groupId: message.groupId,
    authorId: message.authorId,
    author: message.author,
    kind: message.kind,
    content: message.content,
    attachmentUrl: message.attachmentUrl,
    refPostId: message.refPostId,
    replyToMessageId: message.replyToMessageId,
    replyTo: shapeReplyTo(message),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    encryption: message.encryption,
    encryptedPayload: message.encryptedPayload,
  }
}

// Batch-shapes a page of messages with their readBy list in a single extra
// query (one ChatRead.findMany for the whole group), rather than one query
// per message.
export async function shapeChatMessagesWithReadBy(messages: ChatMessageRow[], groupId: string) {
  if (messages.length === 0) return []

  const reads = await prisma.chatRead.findMany({
    where: { groupId },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  })

  return messages.map((message) => {
    const readBy = reads
      .filter((r) => r.userId !== message.authorId && r.lastReadAt >= message.createdAt)
      .map((r) => r.user)
    return shapeChatMessage(message, readBy)
  })
}
