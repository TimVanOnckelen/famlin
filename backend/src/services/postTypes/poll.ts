import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { PostTypeError } from './types.js';
import type { PostTypeHandler } from './types.js';

// Client-sent typeData shape at create time (routes/posts.ts POST /). The
// question itself lives in `content` — not here — so search, notification
// previews, and old clients keep rendering a poll as a plain text post.
const pollTypeDataSchema = z.object({
  options: z.array(z.object({ text: z.string().trim().min(1).max(100) })).min(2).max(10),
  // API-only in v1 — no composer UI builds this yet, but the backend
  // enforces it once set (see interact() below).
  closesAt: z.string().datetime().optional(),
});

interface PollOption {
  id: string;
  text: string;
}

// The persisted shape of Post.typeData for a POLL post — options carry a
// stable id assigned at creation (see transformCreate), since options are
// immutable afterward and votes reference an option by id, not by index/text.
interface PersistedPollTypeData {
  options: PollOption[];
  closesAt: string | null;
}

interface VoteValue {
  optionId: string;
}

function isVoteValue(value: unknown): value is VoteValue {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).optionId === 'string';
}

function isPollClosed(typeData: PersistedPollTypeData): boolean {
  return typeData.closesAt !== null && new Date(typeData.closesAt).getTime() < Date.now();
}

// Decisions already made (see the spec this was built from): votes are
// PUBLIC to group members (non-anonymous), results are always visible even
// before voting, single-choice, options immutable after creation. Vote
// semantics mirror reactions (services/reactions.ts): the same option again
// removes the vote (unvote), a different option switches it.
export const pollHandler: PostTypeHandler = {
  id: 'POLL',

  typeDataSchema: pollTypeDataSchema,

  validateCreate({ content }) {
    if (!content?.trim()) {
      throw new PostTypeError('pollQuestionRequired');
    }
  },

  // Assigns each option a stable id at creation time — no add/remove/edit of
  // options after creation in v1.
  transformCreate(typeData): PersistedPollTypeData {
    const parsed = typeData as z.infer<typeof pollTypeDataSchema>;
    return {
      options: parsed.options.map((option) => ({ id: randomUUID(), text: option.text })),
      closesAt: parsed.closesAt ?? null,
    };
  },

  async interact({ post, userId, key, value }) {
    if (key !== 'vote' || !isVoteValue(value)) {
      throw new PostTypeError('invalidInteraction');
    }

    const typeData = post.typeData as PersistedPollTypeData | null;
    if (!typeData) {
      // A POLL post with no typeData would be a data-integrity bug, not a
      // user mistake — but this is reachable in principle (a corrupted row),
      // so fail the same way an unknown interaction does rather than throw.
      throw new PostTypeError('invalidInteraction');
    }

    if (isPollClosed(typeData)) {
      throw new PostTypeError('pollClosed');
    }

    if (!typeData.options.some((option) => option.id === value.optionId)) {
      throw new PostTypeError('invalidPollOption');
    }

    const existing = await prisma.postInteraction.findUnique({
      where: { postId_userId_key: { postId: post.id, userId, key: 'vote' } },
    });
    const existingOptionId = (existing?.value as VoteValue | undefined)?.optionId;

    if (existing && existingOptionId === value.optionId) {
      // Tapping the same option again removes the vote (unvote).
      await prisma.postInteraction.delete({ where: { id: existing.id } });
    } else if (existing) {
      // Switching: update the existing row instead of delete+create, keeping
      // the one-row-per-user-per-post invariant (@@unique postId_userId_key)
      // intact throughout.
      await prisma.postInteraction.update({ where: { id: existing.id }, data: { value: value as unknown as Prisma.InputJsonValue } });
    } else {
      await prisma.postInteraction.create({ data: { postId: post.id, userId, key: 'vote', value: value as unknown as Prisma.InputJsonValue } });
    }
  },

  // Batch-attaches the enriched `poll` view to every poll post on the page —
  // ONE query for the whole page's votes, aggregated in JS here, rather than
  // a per-post query (see the ONE-query-per-page contract on
  // PostTypeHandler.enrichPosts).
  async enrichPosts(posts, viewerId) {
    const votes = await prisma.postInteraction.findMany({
      where: { postId: { in: posts.map((post) => post.id) }, key: 'vote' },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      // Oldest first, so each option's `voters` list is in vote order.
      orderBy: { createdAt: 'asc' },
    });

    const votesByPostId = new Map<string, typeof votes>();
    for (const vote of votes) {
      const list = votesByPostId.get(vote.postId);
      if (list) list.push(vote);
      else votesByPostId.set(vote.postId, [vote]);
    }

    for (const post of posts) {
      const typeData = post.typeData as PersistedPollTypeData | null;
      if (!typeData) continue;

      const postVotes = votesByPostId.get(post.id) ?? [];
      let myVoteOptionId: string | null = null;

      const options = typeData.options.map((option) => {
        const voters = postVotes
          .filter((vote) => (vote.value as unknown as VoteValue).optionId === option.id)
          .map((vote) => vote.user);
        if (voters.some((voter) => voter.id === viewerId)) {
          myVoteOptionId = option.id;
        }
        return { id: option.id, text: option.text, voteCount: voters.length, voters };
      });

      post.poll = {
        options,
        totalVotes: postVotes.length,
        myVoteOptionId,
        closesAt: typeData.closesAt,
        closed: isPollClosed(typeData),
      };
    }
  },
};
