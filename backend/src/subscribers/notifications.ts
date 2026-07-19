import { onDomainEvent } from '../events.js';
import { prisma } from '../db.js';
import { notifyGroup, notifyUser, notifyUsers, excerptText, reactionEmoji } from '../services/notifications.js';
import { getAllSettings } from '../services/settings.js';
import i18n from '../i18n/index.js';

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
    // Cross-posting fans one write out into several sibling Posts (one per
    // target group) — a member of more than one target group must still get
    // exactly one notification, not one per group they're in. Every member
    // of every target group is a candidate; each is assigned to the FIRST
    // event-post (in emission order) whose group they belong to, then
    // notified once via that post's id/group name.
    const groupIds = event.posts.map((p) => p.groupId);
    const memberships = await prisma.groupMember.findMany({
      where: { groupId: { in: groupIds }, userId: { not: event.authorId } },
      select: { groupId: true, userId: true },
    });
    const groupIdsByUserId = new Map<string, Set<string>>();
    for (const m of memberships) {
      const set = groupIdsByUserId.get(m.userId) ?? new Set<string>();
      set.add(m.groupId);
      groupIdsByUserId.set(m.userId, set);
    }

    const assigned = new Set<string>();
    for (const post of event.posts) {
      const recipientIds = [...groupIdsByUserId.entries()]
        .filter(([userId, groups]) => !assigned.has(userId) && groups.has(post.groupId))
        .map(([userId]) => userId);
      if (recipientIds.length === 0) continue;
      recipientIds.forEach((id) => assigned.add(id));

      await notifyUsers({
        type: 'new_post',
        userIds: recipientIds,
        senderId: event.authorId,
        postId: post.postId,
        params: { author: event.authorName, group: post.groupName, excerpt: excerptText(event.content) },
      });
    }

    // A milestone post in a chitchat-enabled group also drops a system
    // message into that group's chat (deep-linking back to the post via
    // refPostId) — inserted directly, no chat.created event, so it doesn't
    // trigger a second (redundant) notification on top of the new_post one
    // above.
    if (event.type === 'MILESTONE') {
      const chitchatGroups = await prisma.group.findMany({
        where: { id: { in: groupIds }, chitchatEnabled: true },
        select: { id: true },
      });
      if (chitchatGroups.length > 0) {
        const chitchatGroupIds = new Set(chitchatGroups.map((g) => g.id));
        const settings = await getAllSettings();
        const t = i18n.getFixedT(settings.defaultLanguage);
        const label = event.milestoneTag || excerptText(event.content);
        const content = label
          ? t('chat.systemMilestoneMessage', { author: event.authorName, milestoneTag: label })
          : t('chat.systemMilestoneMessageGeneric', { author: event.authorName });

        await prisma.chatMessage.createMany({
          data: event.posts
            .filter((post) => chitchatGroupIds.has(post.groupId))
            .map((post) => ({
              groupId: post.groupId,
              authorId: event.authorId,
              kind: 'SYSTEM_MILESTONE',
              content,
              refPostId: post.postId,
            })),
        });
      }
    }
  });

  onDomainEvent('comment.created', async (event) => {
    // A TRIP check-in (services/postTypes/trip.ts's `checkin` interaction)
    // is stored as a Comment for reuse of the comment infrastructure, but it
    // isn't a conversational reply — it concerns the WHOLE group (like
    // new_post/new_chat_message), not just thread participants, and it must
    // never also fire the generic new_comment notification below. Push-only
    // (no email), same precedent as new_chat_message.
    if (event.metadata && typeof event.metadata === 'object' && (event.metadata as { kind?: unknown }).kind === 'trip_checkin') {
      const place = (event.metadata as { place: string }).place;
      const startOfTodayUtc = new Date();
      startOfTodayUtc.setUTCHours(0, 0, 0, 0);
      // Per check-in AUTHOR (not per trip) — a co-traveler's bundling count
      // is independent of the trip author's. Counted on the event's own
      // post; a cross-posted trip's sibling copies are created in lockstep,
      // so every sibling carries the same per-author count.
      const countToday = await prisma.comment.count({
        where: {
          postId: event.postId,
          authorId: event.authorId,
          metadata: { path: ['kind'], equals: 'trip_checkin' },
          createdAt: { gte: startOfTodayUtc },
        },
      });

      // A cross-posted trip's check-in carries one target per sibling
      // Comment copy — a member of several sibling groups must be notified
      // exactly once, so each candidate is assigned to the FIRST target (in
      // emission order) whose group they belong to. Mirrors the post.created
      // handler above.
      const targets = event.checkinTargets ?? [
        { commentId: event.commentId, postId: event.postId, groupId: event.groupId, groupName: event.groupName },
      ];
      const memberships = await prisma.groupMember.findMany({
        where: { groupId: { in: targets.map((t) => t.groupId) }, userId: { not: event.authorId } },
        select: { groupId: true, userId: true },
      });
      const groupIdsByUserId = new Map<string, Set<string>>();
      for (const m of memberships) {
        const set = groupIdsByUserId.get(m.userId) ?? new Set<string>();
        set.add(m.groupId);
        groupIdsByUserId.set(m.userId, set);
      }

      const assigned = new Set<string>();
      for (const target of targets) {
        const recipientIds = [...groupIdsByUserId.entries()]
          .filter(([userId, groups]) => !assigned.has(userId) && groups.has(target.groupId))
          .map(([userId]) => userId);
        if (recipientIds.length === 0) continue;
        recipientIds.forEach((id) => assigned.add(id));

        await notifyUsers({
          type: 'trip_checkin',
          userIds: recipientIds,
          senderId: event.authorId,
          postId: target.postId,
          // count drives i18next pluralization (tripCheckin_one/_other, see
          // the locale files) — 1 = this author's first check-in today for
          // this trip, 2+ = "checked in N times today, last stop: {place}".
          params: { author: event.authorName, group: target.groupName, place, count: countToday },
        });
      }
      return;
    }

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

  onDomainEvent('chat.created', async (event) => {
    // The one central group chat notifies every OTHER member of the group
    // (notifyGroup already excludes the sender) — mirrors new_post's
    // whole-group scope, not comment.created's thread-participants-only one.
    // SYSTEM_MILESTONE messages are inserted directly by the post.created
    // handler above and never emit chat.created, so this only ever sees USER
    // messages — but the guard stays here too as a second line of defense
    // against ever double-notifying a milestone post.
    if (event.kind !== 'USER') return;

    await notifyGroup({
      type: 'new_chat_message',
      groupId: event.groupId,
      senderId: event.authorId,
      params: {
        author: event.authorName,
        group: event.groupName,
        excerpt: excerptText(event.content, event.hasAttachment ? '📷' : ''),
      },
    });
  });
}
