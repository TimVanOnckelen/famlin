import { prisma } from '../db.js';
import { excerptText } from './notifications.js';

// Shared response shape for a chat message — mirrors services/comments.ts
// shapeComment (a similarly flat shape, no cross-posting/type-handler
// complexity to worry about).

interface ChatMessageRow {
  id: string;
  groupId: string;
  authorId: string;
  author: { id: string; name: string; avatarUrl: string | null };
  kind: string;
  content: string | null;
  attachmentUrl: string | null;
  refPostId: string | null;
  replyToMessageId: string | null;
  replyToMessage: {
    id: string;
    authorId: string;
    author: { id: string; name: string };
    kind: string;
    content: string | null;
    attachmentUrl: string | null;
  } | null;
  createdAt: Date;
  editedAt: Date | null;
}

interface ChatUser {
  id: string;
  name: string;
  avatarUrl: string | null;
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
    replyTo: message.replyToMessage
      ? {
          id: message.replyToMessage.id,
          authorId: message.replyToMessage.authorId,
          authorName: message.replyToMessage.author.name,
          kind: message.replyToMessage.kind,
          // Preserve null (rather than excerptText's '' fallback) for an
          // attachment-only original message — the api-client contract is
          // `content: string | null`, and mobile's replyTo.content ??
          // photoLabel fallback (ChatScreen.tsx) only works if a missing
          // quote is actually null, not an empty string.
          content: message.replyToMessage.content?.trim() ? excerptText(message.replyToMessage.content) : null,
          attachmentUrl: message.replyToMessage.attachmentUrl,
        }
      : null,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    readBy,
  };
}

// Batch-shapes a page of messages with their readBy list in a single extra
// query (one ChatRead.findMany for the whole group), rather than one query
// per message.
export async function shapeChatMessagesWithReadBy(messages: ChatMessageRow[], groupId: string) {
  if (messages.length === 0) return [];

  const reads = await prisma.chatRead.findMany({
    where: { groupId },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });

  return messages.map((message) => {
    const readBy = reads
      .filter((r) => r.userId !== message.authorId && r.lastReadAt >= message.createdAt)
      .map((r) => r.user);
    return shapeChatMessage(message, readBy);
  });
}
