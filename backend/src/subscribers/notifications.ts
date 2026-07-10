import { onDomainEvent } from '../events.js';
import { prisma } from '../db.js';
import { notifyGroup, notifyUser, notifyUsers, excerptText, reactionEmoji } from '../services/notifications.js';

// Translates domain facts into notification decisions — which event type
// notifies whom. Routes only emit what happened (see src/events.ts); every
// "who should be told" rule lives here, so adding another consumer of the
// same events (activity log, webhook, ...) never touches a route.

let registered = false;

export function registerNotificationSubscriber(): void {
  // buildApp() runs once per process in production but many times across a
  // test file — the event handler registry is module-global, so guard against
  // registering (and therefore notifying) twice.
  if (registered) return;
  registered = true;

  onDomainEvent('post.created', async (event) => {
    await notifyGroup({
      type: 'new_post',
      groupId: event.groupId,
      senderId: event.authorId,
      postId: event.postId,
      params: { author: event.authorName, group: event.groupName, excerpt: excerptText(event.content) },
    });
  });

  onDomainEvent('comment.created', async (event) => {
    // Only the post's author and people already participating in this
    // thread are relevant to a new comment — not the whole group.
    const priorParticipants = await prisma.comment.findMany({
      where: { postId: event.postId, id: { not: event.commentId } },
      select: { authorId: true },
      distinct: ['authorId'],
    });
    const candidateIds = [...new Set([event.postAuthorId, ...priorParticipants.map((c) => c.authorId)])];
    // Narrow to people who are still members of the group — a removed member
    // (even the original author) shouldn't keep getting its activity.
    const members = await prisma.groupMember.findMany({
      where: { groupId: event.groupId, userId: { in: candidateIds } },
      select: { userId: true },
    });
    const recipientIds = members.map((m) => m.userId);

    // The client resolves "@name" against the group member list and sends
    // back user ids — re-validate each one is a *current* member of this
    // post's group rather than trusting the client outright (same pattern as
    // the thread-participant lookup above).
    let mentionedIds: string[] = [];
    if (event.mentionedUserIds.length > 0) {
      const mentionMembers = await prisma.groupMember.findMany({
        where: { groupId: event.groupId, userId: { in: event.mentionedUserIds } },
        select: { userId: true },
      });
      mentionedIds = mentionMembers.map((m) => m.userId).filter((id) => id !== event.authorId);
    }
    // A mentioned thread participant gets the "mention" notification instead
    // of the generic "new_comment" one, so they aren't notified twice.
    const threadRecipientIds = recipientIds.filter((id) => !mentionedIds.includes(id));

    const params = {
      author: event.authorName,
      group: event.groupName,
      excerpt: excerptText(event.content, event.hasAttachment ? '📷' : ''),
    };

    await notifyUsers({
      type: 'new_comment',
      userIds: threadRecipientIds,
      senderId: event.authorId,
      postId: event.postId,
      params,
    });

    if (mentionedIds.length > 0) {
      await notifyUsers({
        type: 'mention',
        userIds: mentionedIds,
        senderId: event.authorId,
        postId: event.postId,
        params,
      });
    }
  });

  onDomainEvent('reaction.added', async (event) => {
    // Reacting to your own post/comment is a valid fact but not worth a
    // notification (notify() would drop the sender anyway — skip the work).
    if (event.targetAuthorId === event.reactorId) return;

    await notifyUser({
      type: event.targetKind === 'post' ? 'new_like_post' : 'new_like_comment',
      userId: event.targetAuthorId,
      senderId: event.reactorId,
      postId: event.postId,
      params: {
        author: event.reactorName,
        group: event.groupName,
        excerpt: excerptText(event.targetContent),
        emoji: reactionEmoji(event.reactionType),
      },
    });
  });
}
