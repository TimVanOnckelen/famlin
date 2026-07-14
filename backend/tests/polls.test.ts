import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/db.js';
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader } from './helpers.js';

// Custom post types + polls (services/postTypes/) — Post.type is now an open
// string discriminator validated by a PostTypeHandler registry, and
// PostInteraction is the generic per-user-state table (votes today). See
// CLAUDE.md and services/postTypes/poll.ts for the full contract: votes are
// public, single-choice, options immutable after creation, and vote
// semantics mirror reactions (same option again = unvote, different =
// switch).
describe('custom post types + polls', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('creating a poll', () => {
    it('persists generated option ids and returns typeData on the create response', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: group.id,
          content: 'Pizza or tacos?',
          type: 'POLL',
          typeData: { options: [{ text: 'Pizza' }, { text: 'Tacos' }] },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe('POLL');
      expect(body.content).toBe('Pizza or tacos?');
      expect(body.typeData.options).toHaveLength(2);
      for (const option of body.typeData.options) {
        expect(typeof option.id).toBe('string');
        expect(option.id.length).toBeGreaterThan(0);
      }
      expect(body.typeData.options.map((o: { text: string }) => o.text)).toEqual(['Pizza', 'Tacos']);
      expect(body.typeData.closesAt).toBeNull();

      const row = await prisma.post.findUniqueOrThrow({ where: { id: body.id } });
      expect((row.typeData as any).options).toHaveLength(2);
      expect((row.typeData as any).options[0].id).toBe(body.typeData.options[0].id);

      // The enriched `poll` view is only attached by the list/GET-one seam,
      // not the create response (mirrors the existing `people: []` behavior
      // for a freshly created post) — but the raw typeData above already
      // carries everything a client needs to render a zero-vote poll.
      expect(body.poll).toBeUndefined();

      const get = await app.inject({ method: 'GET', url: `/api/posts/${body.id}`, headers: authHeader(author) });
      expect(get.statusCode).toBe(200);
      expect(get.json().poll).toEqual({
        options: body.typeData.options.map((o: { id: string; text: string }) => ({ id: o.id, text: o.text, voteCount: 0, voters: [] })),
        totalVotes: 0,
        myVoteOptionId: null,
        closesAt: null,
        closed: false,
      });
    });

    it('rejects a poll with an empty question', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, type: 'POLL', typeData: { options: [{ text: 'A' }, { text: 'B' }] } },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects fewer than 2 options', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'Question?', type: 'POLL', typeData: { options: [{ text: 'Only one' }] } },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects more than 10 options', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: group.id,
          content: 'Question?',
          type: 'POLL',
          typeData: { options: Array.from({ length: 11 }, (_, i) => ({ text: `Option ${i}` })) },
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown post type', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'hi', type: 'BOGUS' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects typeData sent for a plain UPDATE post', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'hi', typeData: { anything: true } },
      });

      expect(res.statusCode).toBe(400);
    });

    it('still creates a plain UPDATE post unchanged (regression)', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'just an update' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe('UPDATE');
      expect(body.typeData).toBeNull();
      expect(body.poll).toBeUndefined();
    });

    it('still creates a MILESTONE post unchanged (regression)', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'first steps!', type: 'MILESTONE', milestoneTag: 'first_steps' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.type).toBe('MILESTONE');
      expect(body.milestoneTag).toBe('first_steps');
      expect(body.typeData).toBeNull();
    });
  });

  describe('voting', () => {
    async function createPoll(app: FastifyInstance, author: { id: string; email: string; name: string; isAdmin: boolean }, groupId: string) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId,
          content: 'Cats or dogs?',
          type: 'POLL',
          typeData: { options: [{ text: 'Cats' }, { text: 'Dogs' }] },
        },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as { id: string; typeData: { options: { id: string; text: string }[] } };
    }

    it('votes, switches, and unvotes, updating counts/voters/myVoteOptionId', async () => {
      const author = await createUser();
      const voter = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, voter.id);

      const poll = await createPoll(app, author, group.id);
      const [cats, dogs] = poll.typeData.options;

      const vote1 = await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(voter),
        payload: { key: 'vote', value: { optionId: cats.id } },
      });
      expect(vote1.statusCode).toBe(200);
      let body = vote1.json();
      expect(body.poll.myVoteOptionId).toBe(cats.id);
      expect(body.poll.totalVotes).toBe(1);
      const catsOption = body.poll.options.find((o: any) => o.id === cats.id);
      expect(catsOption.voteCount).toBe(1);
      expect(catsOption.voters).toEqual([{ id: voter.id, name: voter.name, avatarUrl: null }]);

      // Switching to Dogs moves the vote, doesn't add a second one.
      const vote2 = await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(voter),
        payload: { key: 'vote', value: { optionId: dogs.id } },
      });
      expect(vote2.statusCode).toBe(200);
      body = vote2.json();
      expect(body.poll.myVoteOptionId).toBe(dogs.id);
      expect(body.poll.totalVotes).toBe(1);
      expect(body.poll.options.find((o: any) => o.id === cats.id).voteCount).toBe(0);
      expect(body.poll.options.find((o: any) => o.id === dogs.id).voteCount).toBe(1);

      // Voting the same option again unvotes.
      const vote3 = await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(voter),
        payload: { key: 'vote', value: { optionId: dogs.id } },
      });
      expect(vote3.statusCode).toBe(200);
      body = vote3.json();
      expect(body.poll.myVoteOptionId).toBeNull();
      expect(body.poll.totalVotes).toBe(0);

      const rows = await prisma.postInteraction.findMany({ where: { postId: poll.id, userId: voter.id } });
      expect(rows).toHaveLength(0);
    });

    it('rejects a non-member voting, and a non-member cannot see the poll', async () => {
      const author = await createUser();
      const outsider = await createUser();
      const group = await createGroupWithMember(author);

      const poll = await createPoll(app, author, group.id);
      const optionId = poll.typeData.options[0].id;

      const vote = await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(outsider),
        payload: { key: 'vote', value: { optionId } },
      });
      expect(vote.statusCode).toBe(403);

      const get = await app.inject({ method: 'GET', url: `/api/posts/${poll.id}`, headers: authHeader(outsider) });
      expect(get.statusCode).toBe(403);
    });

    it('rejects voting on a closed poll', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const poll = await createPoll(app, author, group.id);

      // Backdate closesAt directly — v1 has no composer UI for it, but the
      // backend must still enforce it once set.
      await prisma.post.update({
        where: { id: poll.id },
        data: { typeData: { ...poll.typeData, closesAt: new Date(Date.now() - 60_000).toISOString() } as any },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'vote', value: { optionId: poll.typeData.options[0].id } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown optionId', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const poll = await createPoll(app, author, group.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'vote', value: { optionId: 'does-not-exist' } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown interaction key', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const poll = await createPoll(app, author, group.id);

      const res = await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'rsvp', value: { optionId: poll.typeData.options[0].id } },
      });
      expect(res.statusCode).toBe(400);
    });

    it('emits no domain event / notification for a vote', async () => {
      const author = await createUser();
      const voter = await createUser();
      const group = await createGroupWithMember(author);
      await addMember(group.id, voter.id);
      const poll = await createPoll(app, author, group.id);

      await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(voter),
        payload: { key: 'vote', value: { optionId: poll.typeData.options[0].id } },
      });

      const notifications = await prisma.notification.findMany({ where: { relatedPostId: poll.id, userId: author.id } });
      expect(notifications).toHaveLength(0);
    });

    it('deletes cleanly, cascading its interactions', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      const poll = await createPoll(app, author, group.id);

      await app.inject({
        method: 'POST',
        url: `/api/posts/${poll.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'vote', value: { optionId: poll.typeData.options[0].id } },
      });
      expect(await prisma.postInteraction.count({ where: { postId: poll.id } })).toBe(1);

      const del = await app.inject({ method: 'DELETE', url: `/api/posts/${poll.id}`, headers: authHeader(author) });
      expect(del.statusCode).toBe(200);

      expect(await prisma.postInteraction.count({ where: { postId: poll.id } })).toBe(0);
    });
  });

  describe('per-group allowed post types', () => {
    it('rejects creating a POLL in a group restricted to UPDATE only', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);
      await prisma.group.update({ where: { id: group.id }, data: { allowedPostTypes: ['UPDATE'] } });

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: group.id,
          content: 'not allowed here',
          type: 'POLL',
          typeData: { options: [{ text: 'A' }, { text: 'B' }] },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(await prisma.post.count({ where: { groupId: group.id } })).toBe(0);

      // UPDATE is still fine in the same group.
      const update = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: { groupId: group.id, content: 'plain update' },
      });
      expect(update.statusCode).toBe(200);
    });

    it('rejects a cross-post when ONE target group disallows the type, creating zero sibling rows', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);
      await prisma.group.update({ where: { id: groupB.id }, data: { allowedPostTypes: ['UPDATE', 'MILESTONE'] } });

      const res = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupIds: [groupA.id, groupB.id],
          content: 'blocked cross-post poll',
          type: 'POLL',
          typeData: { options: [{ text: 'A' }, { text: 'B' }] },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(await prisma.post.count({ where: { content: 'blocked cross-post poll' } })).toBe(0);
    });

    it('allows every registered type when allowedPostTypes is empty', async () => {
      const author = await createUser();
      const group = await createGroupWithMember(author);

      const poll = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupId: group.id,
          content: 'polls allowed by default',
          type: 'POLL',
          typeData: { options: [{ text: 'A' }, { text: 'B' }] },
        },
      });
      expect(poll.statusCode).toBe(200);
    });

    it('exposes the RESOLVED effective list (never empty) on member group endpoints', async () => {
      const member = await createUser();
      const openGroup = await createGroupWithMember(member);
      const restrictedGroup = await createGroupWithMember(member);
      await prisma.group.update({ where: { id: restrictedGroup.id }, data: { allowedPostTypes: ['UPDATE'] } });

      const list = await app.inject({ method: 'GET', url: '/api/groups', headers: authHeader(member) });
      expect(list.statusCode).toBe(200);
      const byId = new Map(list.json().map((g: any) => [g.id, g]));
      expect((byId.get(openGroup.id) as any).allowedPostTypes).toEqual(['UPDATE', 'MILESTONE', 'POLL']);
      expect((byId.get(restrictedGroup.id) as any).allowedPostTypes).toEqual(['UPDATE']);

      const detail = await app.inject({ method: 'GET', url: `/api/groups/${restrictedGroup.id}`, headers: authHeader(member) });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().allowedPostTypes).toEqual(['UPDATE']);
    });

    it('admin group update validates unknown post type ids', async () => {
      const admin = await createUser({ isAdmin: true });
      const group = await createGroupWithMember(admin);

      const bad = await app.inject({
        method: 'PATCH',
        url: `/api/admin/groups/${group.id}`,
        headers: authHeader(admin),
        payload: { allowedPostTypes: ['UPDATE', 'BOGUS'] },
      });
      expect(bad.statusCode).toBe(400);

      const row = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
      expect(row.allowedPostTypes).toEqual([]);

      // A valid list persists, and the admin response carries the RAW stored
      // array (not the resolved list).
      const good = await app.inject({
        method: 'PATCH',
        url: `/api/admin/groups/${group.id}`,
        headers: authHeader(admin),
        payload: { allowedPostTypes: ['UPDATE', 'POLL'] },
      });
      expect(good.statusCode).toBe(200);
      expect(good.json().allowedPostTypes).toEqual(['UPDATE', 'POLL']);

      // An explicit empty array resets back to "all allowed".
      const reset = await app.inject({
        method: 'PATCH',
        url: `/api/admin/groups/${group.id}`,
        headers: authHeader(admin),
        payload: { allowedPostTypes: [] },
      });
      expect(reset.statusCode).toBe(200);
      expect(reset.json().allowedPostTypes).toEqual([]);
    });

    it('admin group create accepts allowedPostTypes and rejects unknown ids', async () => {
      const admin = await createUser({ isAdmin: true });

      const bad = await app.inject({
        method: 'POST',
        url: '/api/admin/groups',
        headers: authHeader(admin),
        payload: { name: 'Bad Types Group', allowedPostTypes: ['NOPE'] },
      });
      expect(bad.statusCode).toBe(400);
      expect(await prisma.group.count({ where: { name: 'Bad Types Group' } })).toBe(0);

      const good = await app.inject({
        method: 'POST',
        url: '/api/admin/groups',
        headers: authHeader(admin),
        payload: { name: 'Update Only Group', allowedPostTypes: ['UPDATE'] },
      });
      expect(good.statusCode).toBe(200);
      expect(good.json().allowedPostTypes).toEqual(['UPDATE']);
    });

    it('GET /api/admin/post-types lists the registered types (admin only)', async () => {
      const admin = await createUser({ isAdmin: true });
      const member = await createUser();

      const res = await app.inject({ method: 'GET', url: '/api/admin/post-types', headers: authHeader(admin) });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([{ id: 'UPDATE' }, { id: 'MILESTONE' }, { id: 'POLL' }]);

      const denied = await app.inject({ method: 'GET', url: '/api/admin/post-types', headers: authHeader(member) });
      expect(denied.statusCode).toBe(403);
    });
  });

  describe('cross-posted polls', () => {
    it('gives each sibling its own typeData copy and keeps votes isolated per sibling', async () => {
      const author = await createUser();
      const groupA = await createGroupWithMember(author);
      const groupB = await createGroupWithMember(author);

      const create = await app.inject({
        method: 'POST',
        url: '/api/posts',
        headers: authHeader(author),
        payload: {
          groupIds: [groupA.id, groupB.id],
          content: 'Cross-posted poll',
          type: 'POLL',
          typeData: { options: [{ text: 'Yes' }, { text: 'No' }] },
        },
      });
      expect(create.statusCode).toBe(200);

      const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'Cross-posted poll' } });
      const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, content: 'Cross-posted poll' } });

      expect(postA.typeData).not.toBeNull();
      expect(postB.typeData).not.toBeNull();
      // Same option ids across siblings is intended (spec: "same option ids
      // across siblings is fine and intended").
      expect((postA.typeData as any).options.map((o: any) => o.id)).toEqual((postB.typeData as any).options.map((o: any) => o.id));

      const optionId = (postA.typeData as any).options[0].id;

      const vote = await app.inject({
        method: 'POST',
        url: `/api/posts/${postA.id}/interactions`,
        headers: authHeader(author),
        payload: { key: 'vote', value: { optionId } },
      });
      expect(vote.statusCode).toBe(200);
      expect(vote.json().poll.totalVotes).toBe(1);

      const getA = await app.inject({ method: 'GET', url: `/api/posts/${postA.id}`, headers: authHeader(author) });
      const getB = await app.inject({ method: 'GET', url: `/api/posts/${postB.id}`, headers: authHeader(author) });
      expect(getA.json().poll.totalVotes).toBe(1);
      expect(getB.json().poll.totalVotes).toBe(0);
      expect(getB.json().poll.myVoteOptionId).toBeNull();
    });
  });
});
