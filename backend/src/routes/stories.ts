import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../db.js';
import {
  createStoryBodySchema,
  paginationQuerySchema,
  storyReactionBodySchema,
  storyReplyBodySchema,
} from '../types.js';
import { requireGroupMember } from '../plugins/auth.js';
import { getUserGroupIds } from '../services/groups.js';
import { getUserCircleIds, validateCircleTarget, visibleStoriesWhere } from '../services/circles.js';
import { claimUnboundUpload, isUnboundUploadOwnedBy } from '../services/uploads.js';
import { paginationArgs, paginate } from '../services/pagination.js';
import { emitDomainEvent } from '../events.js';
import { getT } from '../i18n/index.js';
import {
  STORY_LIFETIME_MS,
  dedupeSiblings,
  deleteStoriesWithMedia,
  findVisibleStory,
  isLive,
  shapeStories,
  siblingIds,
  siblingsWhere,
  storyInclude,
  type ShapedStory,
} from '../services/stories.js';

// Resolves the tray/highlights `?groupIds=` filter exactly like GET
// /api/posts does: a comma-separated subset of the caller's groups, or every
// group they're in when omitted. A requested group they aren't in is a 403.
// Returns null after sending that 403 (callers must `return`).
async function resolveGroupFilter(request: FastifyRequest, reply: FastifyReply): Promise<string[] | null> {
  const { groupIds } = request.query as { groupIds?: string };
  const memberGroupIds = await getUserGroupIds(request.user!.id);
  if (!groupIds) return memberGroupIds;

  const requested = [...new Set(groupIds.split(',').filter(Boolean))];
  if (requested.length === 0 || requested.some((id) => !memberGroupIds.includes(id))) {
    reply.status(403).send({ error: getT(request)('errors.notGroupMember') });
    return null;
  }
  return requested;
}

export default async function storyRoutes(fastify: FastifyInstance) {
  // The story tray: every author with a live story in the selected groups,
  // each with their live items oldest→newest (the order they play in). Your
  // own stories come first, then authors with something you haven't seen,
  // then the rest — each block newest-activity first. Not paginated: a tray
  // is bounded by the 24h window, and the viewer needs every item of an
  // author to play them in sequence.
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const groupIds = await resolveGroupFilter(request, reply);
    if (!groupIds) return;
    if (groupIds.length === 0) return { authors: [] };

    const circleIds = await getUserCircleIds(userId);
    const rows = await prisma.story.findMany({
      where: { AND: [visibleStoriesWhere(groupIds, circleIds), { expiresAt: { gt: new Date() } }] },
      include: storyInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const stories = await shapeStories(dedupeSiblings(rows), userId);

    const byAuthor = new Map<string, ShapedStory[]>();
    for (const story of stories) {
      const list = byAuthor.get(story.author.id) ?? [];
      list.push(story);
      byAuthor.set(story.author.id, list);
    }

    const authors = [...byAuthor.values()].map((items) => ({
      author: items[0].author,
      hasUnseen: items.some((s) => !s.seen),
      latestAt: items[items.length - 1].createdAt,
      stories: items,
    }));
    const rank = (a: (typeof authors)[number]) => (a.author.id === userId ? 0 : a.hasUnseen ? 1 : 2);
    authors.sort((a, b) => rank(a) - rank(b) || b.latestAt.getTime() - a.latestAt.getTime());

    return { authors };
  });

  // The Highlights row: every pinned story in the selected groups as one
  // flat list ordered by the story's own date, newest first.
  fastify.get('/highlights', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const groupIds = await resolveGroupFilter(request, reply);
    if (!groupIds) return;
    const { cursor, take } = paginationQuerySchema.parse(request.query);
    if (groupIds.length === 0) return { items: [], nextCursor: null };

    const circleIds = await getUserCircleIds(userId);
    const rows = await prisma.story.findMany({
      where: { AND: [visibleStoriesWhere(groupIds, circleIds), { pinnedAt: { not: null } }] },
      include: storyInclude,
      // Cross-post siblings share createdAt, so id breaks the tie — which
      // also keeps siblings adjacent in this order.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...paginationArgs({ cursor, take }),
    });
    const { items, nextCursor } = paginate(rows, take);

    // Siblings are adjacent, so one split across a page boundary always has
    // the previous page's last row (the cursor) as a sibling.
    let deduped = dedupeSiblings(items);
    if (cursor && deduped.length > 0) {
      const cursorRow = await prisma.story.findUnique({ where: { id: cursor }, select: { crossStoryId: true } });
      if (cursorRow?.crossStoryId) {
        deduped = deduped.filter((s) => s.crossStoryId !== cursorRow.crossStoryId);
      }
    }

    return { items: await shapeStories(deduped, userId), nextCursor };
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const story = await findVisibleStory(id, request.user!.id);
    if (!story) return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });
    const [shaped] = await shapeStories([story], request.user!.id);
    return shaped;
  });

  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const userId = request.user!.id;
    const body = createStoryBodySchema.parse(request.body);
    const targets = [...new Set(body.groupIds ?? [body.groupId!])];

    for (const groupId of targets) {
      if (await requireGroupMember(request, reply, groupId)) return;
    }

    // Same collapse-to-one-403 rule as post creation: a non-member must not
    // be able to tell "not your circle" from "no such circle".
    const circleId = body.circleId ?? null;
    if (circleId && (await validateCircleTarget(circleId, targets[0], userId))) {
      return reply.status(403).send({ error: t('errors.notCircleMember') });
    }

    // EVERY target group must have stories on — checked before anything is
    // written, so a cross-post creates all its rows or none.
    const groups = await prisma.group.findMany({
      where: { id: { in: targets } },
      select: { id: true, name: true, storiesEnabled: true },
    });
    if (groups.some((g) => !g.storiesEnabled)) {
      return reply.status(403).send({ error: t('errors.storiesDisabled') });
    }

    // The photo is deleted from disk when the story expires, so it has to
    // be a fresh upload of the author's own that nothing else references.
    if (!(await isUnboundUploadOwnedBy(body.imageUrl, userId))) {
      return reply.status(400).send({ error: t('errors.invalidStoryImage') });
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + STORY_LIFETIME_MS);
    const crossStoryId = targets.length > 1 ? randomUUID() : null;

    // The upload is claimed inside the transaction (a conditional update, not
    // just the check above), so two concurrent requests can't both turn the
    // same file into a story — the loser rolls back and gets the same 400.
    const created = await prisma.$transaction(async (tx) => {
      if (!(await claimUnboundUpload(body.imageUrl, userId, circleId, tx))) return null;
      const rows = [];
      for (const groupId of targets) {
        rows.push(
          await tx.story.create({
            data: { authorId: userId, groupId, circleId, crossStoryId, imageUrl: body.imageUrl, createdAt, expiresAt },
            include: storyInclude,
          })
        );
      }
      return rows;
    });
    if (!created) return reply.status(400).send({ error: t('errors.invalidStoryImage') });

    emitDomainEvent('story.created', {
      stories: created.map((s) => ({ storyId: s.id, groupId: s.groupId, groupName: s.group.name })),
      authorId: userId,
      authorName: created[0].author.name,
      circleId,
      createdAt,
    });

    const [shaped] = await shapeStories([created[0]], userId);
    return shaped;
  });

  // Records a "seen by" receipt. Idempotent, silently ignored for the
  // author's own story, and a no-op once the story has expired — which is
  // what freezes a Highlight's seen-by list at its original 24 hours.
  fastify.post('/:id/view', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const story = await findVisibleStory(id, userId);
    if (!story) return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });

    if (story.authorId !== userId && isLive(story)) {
      await prisma.storyView.upsert({
        where: { storyId_userId: { storyId: story.id, userId } },
        create: { storyId: story.id, userId },
        update: {},
      });
    }
    return { success: true };
  });

  // Author-only: who has seen this story (one entry per person across
  // cross-post siblings, earliest view wins). Everyone else gets the same
  // 404 as a story they can't see.
  fastify.get('/:id/views', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const story = await findVisibleStory(id, userId);
    if (!story || story.authorId !== userId) {
      return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });
    }

    const views = await prisma.storyView.findMany({
      where: { storyId: { in: await siblingIds(story) } },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { viewedAt: 'asc' },
    });
    const seen = new Set<string>();
    const items = views
      .filter((v) => (seen.has(v.userId) ? false : (seen.add(v.userId), true)))
      .map((v) => ({ ...v.user, viewedAt: v.viewedAt }))
      .reverse();
    return { items };
  });

  // Toggle/switch semantics like POST /api/posts/:postId/like: the same
  // reaction again removes it, a different one replaces it. One reaction per
  // person across all cross-post siblings.
  fastify.post('/:id/reaction', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const { type } = storyReactionBodySchema.parse(request.body ?? {});
    const story = await findVisibleStory(id, userId);
    if (!story) return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });

    const ids = await siblingIds(story);
    const existing = await prisma.storyReaction.findFirst({ where: { storyId: { in: ids }, userId } });

    let myReaction: typeof type | null;
    if (existing && existing.type === type) {
      await prisma.storyReaction.delete({ where: { id: existing.id } });
      myReaction = null;
    } else if (existing) {
      await prisma.storyReaction.update({ where: { id: existing.id }, data: { type } });
      myReaction = type;
    } else {
      await prisma.storyReaction.create({ data: { storyId: story.id, userId, type } });
      myReaction = type;
    }

    if (myReaction && story.authorId !== userId) {
      emitDomainEvent('story.reaction.added', {
        storyId: story.id,
        groupName: story.group.name,
        storyAuthorId: story.authorId,
        reactorId: userId,
        reactorName: request.user!.name,
        reactionType: myReaction,
      });
    }

    return { myReaction };
  });

  fastify.get('/:id/reactions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const story = await findVisibleStory(id, userId);
    if (!story || story.authorId !== userId) {
      return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });
    }

    const reactions = await prisma.storyReaction.findMany({
      where: { storyId: { in: await siblingIds(story) } },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: reactions.map((r) => ({ ...r.user, type: r.type })) };
  });

  // A private, one-shot reply to the author. Only while the story is live,
  // never to yourself, and one per person — there is no thread.
  fastify.post('/:id/reply', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const { content } = storyReplyBodySchema.parse(request.body);
    const story = await findVisibleStory(id, userId);
    if (!story) return reply.status(404).send({ error: t('errors.storyNotFound') });
    if (!isLive(story)) return reply.status(400).send({ error: t('errors.storyExpired') });
    if (story.authorId === userId) return reply.status(400).send({ error: t('errors.cannotReplyToOwnStory') });

    const ids = await siblingIds(story);
    if (await prisma.storyReply.findFirst({ where: { storyId: { in: ids }, fromUserId: userId } })) {
      return reply.status(409).send({ error: t('errors.storyReplyExists') });
    }

    const created = await prisma.storyReply.create({
      data: { storyId: story.id, fromUserId: userId, content },
    });

    emitDomainEvent('story.reply.created', {
      storyId: story.id,
      groupName: story.group.name,
      storyAuthorId: story.authorId,
      fromUserId: userId,
      fromUserName: request.user!.name,
      content,
    });

    return { content: created.content, createdAt: created.createdAt };
  });

  // Author-only. Replies are private between the viewer and the author, so
  // no other surface — admin moderation, push log, export — ever reads them.
  fastify.get('/:id/replies', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const story = await findVisibleStory(id, userId);
    if (!story || story.authorId !== userId) {
      return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });
    }

    const replies = await prisma.storyReply.findMany({
      where: { storyId: { in: await siblingIds(story) } },
      include: { fromUser: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: replies.map((r) => ({ id: r.id, fromUser: r.fromUser, content: r.content, createdAt: r.createdAt })),
    };
  });

  // Author-only, and only while live: pinning is what saves a story from
  // expiry, so an already-expired story can't be rescued after the fact.
  // Fans out to every cross-post sibling.
  fastify.post('/:id/pin', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const t = getT(request);
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const story = await findVisibleStory(id, userId);
    if (!story || story.authorId !== userId) return reply.status(404).send({ error: t('errors.storyNotFound') });
    if (!isLive(story)) return reply.status(400).send({ error: t('errors.storyExpired') });

    const pinnedAt = story.pinnedAt ?? new Date();
    await prisma.story.updateMany({ where: { ...siblingsWhere(story), authorId: userId }, data: { pinnedAt } });
    return { pinnedAt, deleted: false };
  });

  // Unpinning a live story just makes it ephemeral again. Unpinning an
  // expired Highlight has nothing to fall back to, so it deletes the story
  // (clients confirm first).
  fastify.delete('/:id/pin', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const story = await findVisibleStory(id, userId);
    if (!story || story.authorId !== userId) {
      return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });
    }

    if (!isLive(story)) {
      await deleteStoriesWithMedia({ ...siblingsWhere(story), authorId: userId });
      return { pinnedAt: null, deleted: true };
    }
    await prisma.story.updateMany({ where: { ...siblingsWhere(story), authorId: userId }, data: { pinnedAt: null } });
    return { pinnedAt: null, deleted: false };
  });

  // Author delete — every sibling, plus the photo. Admin moderation is a
  // separate, per-group route in routes/admin.ts.
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;
    const story = await findVisibleStory(id, userId);
    if (!story || story.authorId !== userId) {
      return reply.status(404).send({ error: getT(request)('errors.storyNotFound') });
    }

    await deleteStoriesWithMedia({ ...siblingsWhere(story), authorId: userId });
    return { success: true };
  });
}
