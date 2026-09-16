import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, createUser, authHeader, createGroup, addMember } from './helpers.js';
import { prisma } from '../src/db.js';

// The Family Circles authorization matrix.
//
// A Circle narrows a Group's audience, so the property under test is always
// the same: an "outsider" — a full member of the group who is NOT in the
// circle — must not be able to reach the circle's content or even confirm it
// exists, through ANY surface. Every leak path the feature could have is
// asserted here explicitly, because each one fails open if it's forgotten.

let app: FastifyInstance;

let author: Awaited<ReturnType<typeof createUser>>;
let insider: Awaited<ReturnType<typeof createUser>>;
let outsider: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;
let group: Awaited<ReturnType<typeof createGroup>>;
let circle: { id: string };

// A circle-scoped post and an ordinary whole-family post in the same group,
// so every assertion can show the outsider CAN see the family post — proving
// the filter is narrowing on the circle and not just returning nothing.
let circlePostId: string;
let familyPostId: string;

beforeAll(async () => {
  app = await buildTestApp();

  author = await createUser({ name: 'Circle Author' });
  insider = await createUser({ name: 'Circle Insider' });
  outsider = await createUser({ name: 'Group Outsider' });
  admin = await createUser({ name: 'Family Admin', isAdmin: true });

  group = await createGroup({ name: 'Circles Test Family' });
  for (const u of [author, insider, outsider, admin]) await addMember(group.id, u.id);

  circle = await prisma.circle.create({
    data: {
      groupId: group.id,
      name: 'Grandparents',
      members: { create: [{ userId: author.id }, { userId: insider.id }] },
    },
  });

  const circlePost = await app.inject({
    method: 'POST',
    url: '/api/posts',
    headers: authHeader(author),
    payload: { groupId: group.id, content: 'Secret circle news', circleId: circle.id },
  });
  expect(circlePost.statusCode).toBe(200);
  circlePostId = circlePost.json().id;

  const familyPost = await app.inject({
    method: 'POST',
    url: '/api/posts',
    headers: authHeader(author),
    payload: { groupId: group.id, content: 'Everyone can see this' },
  });
  familyPostId = familyPost.json().id;
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { id: group.id } });
  await prisma.user.deleteMany({ where: { id: { in: [author.id, insider.id, outsider.id, admin.id] } } });
  await app.close();
});

describe('circle post creation', () => {
  it('rejects a post to a circle the author is not in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(outsider),
      payload: { groupId: group.id, content: 'sneaking in', circleId: circle.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a circle belonging to a different group', async () => {
    const otherGroup = await createGroup({ name: 'Other Family' });
    await addMember(otherGroup.id, author.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: otherGroup.id, content: 'wrong group', circleId: circle.id },
    });
    expect(res.statusCode).toBe(403);

    await prisma.group.delete({ where: { id: otherGroup.id } });
  });

  it('rejects combining a circle with cross-posting', async () => {
    const second = await createGroup({ name: 'Second Family' });
    await addMember(second.id, author.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [group.id, second.id], content: 'both', circleId: circle.id },
    });
    expect(res.statusCode).toBe(400);

    await prisma.group.delete({ where: { id: second.id } });
  });
});

describe('circle post visibility', () => {
  it('shows the circle post in an insider feed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(insider) });
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).toContain(circlePostId);
    expect(ids).toContain(familyPostId);
  });

  it('hides the circle post from an outsider feed but keeps the family post', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(outsider) });
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(circlePostId);
    expect(ids).toContain(familyPostId);
  });

  it('404s the circle post detail for an outsider', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/posts/${circlePostId}`, headers: authHeader(outsider) });
    expect(res.statusCode).toBe(404);
  });

  it('hides the circle post from an outsider search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/search?groupId=${group.id}&q=Secret`,
      headers: authHeader(outsider),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
  });

  it('shows the circle post in an insider search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/search?groupId=${group.id}&q=Secret`,
      headers: authHeader(insider),
    });
    expect(res.json().items.map((p: { id: string }) => p.id)).toContain(circlePostId);
  });
});

describe('circle content permissions', () => {
  it('404s comments on a circle post for an outsider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/${circlePostId}/comments`,
      headers: authHeader(outsider),
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses an outsider commenting on a circle post', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${circlePostId}/comments`,
      headers: authHeader(outsider),
      payload: { content: 'butting in' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses an outsider reacting to a circle post', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${circlePostId}/like`,
      headers: authHeader(outsider),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses an outsider reading the reaction list of a circle post', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/${circlePostId}/reactions`,
      headers: authHeader(outsider),
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses an outsider favoriting a circle post', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${circlePostId}/favorite`,
      headers: authHeader(outsider),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('lets an insider comment on a circle post', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/posts/${circlePostId}/comments`,
      headers: authHeader(insider),
      payload: { content: 'lovely' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('circle membership revocation', () => {
  it('drops a removed member back to whole-family visibility immediately', async () => {
    const leaver = await createUser({ name: 'Leaver' });
    await addMember(group.id, leaver.id);
    await prisma.circleMember.create({ data: { circleId: circle.id, userId: leaver.id } });

    const before = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(leaver) });
    expect(before.json().items.map((p: { id: string }) => p.id)).toContain(circlePostId);

    const leave = await app.inject({
      method: 'DELETE',
      url: `/api/circles/${circle.id}/members/me`,
      headers: authHeader(leaver),
    });
    expect(leave.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(leaver) });
    const ids = after.json().items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(circlePostId);
    // Leaving a circle must never remove them from the family itself.
    expect(ids).toContain(familyPostId);
    expect(await prisma.groupMember.findFirst({ where: { groupId: group.id, userId: leaver.id } })).not.toBeNull();

    await prisma.user.delete({ where: { id: leaver.id } });
  });

  it('revokes access through an old favorite', async () => {
    const fan = await createUser({ name: 'Fan' });
    await addMember(group.id, fan.id);
    await prisma.circleMember.create({ data: { circleId: circle.id, userId: fan.id } });

    await app.inject({
      method: 'POST',
      url: `/api/posts/${circlePostId}/favorite`,
      headers: authHeader(fan),
      payload: {},
    });
    const before = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(fan) });
    expect(before.json().items).toHaveLength(1);

    await prisma.circleMember.deleteMany({ where: { circleId: circle.id, userId: fan.id } });

    const after = await app.inject({ method: 'GET', url: '/api/favorites', headers: authHeader(fan) });
    expect(after.json().items).toHaveLength(0);

    await prisma.user.delete({ where: { id: fan.id } });
  });
});

describe('removing a group member cascades to their circles', () => {
  it('revokes circle access when they are removed from the family', async () => {
    const removed = await createUser({ name: 'Removed Member' });
    // Deleting the user cascades their memberships, so this runs even when an
    // assertion below throws — otherwise a failure here would leave stale
    // CircleMember rows and break the unrelated member-count tests.
    try {
      await addMember(group.id, removed.id);
      await prisma.circleMember.create({ data: { circleId: circle.id, userId: removed.id } });

      const before = await app.inject({
        method: 'GET',
        url: `/api/posts/${circlePostId}`,
        headers: authHeader(removed),
      });
      expect(before.statusCode).toBe(200);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/groups/${group.id}/members/${removed.id}`,
        headers: authHeader(admin),
      });
      expect(res.statusCode).toBe(200);

      // A circle only ever narrows group membership, so a circle membership
      // must never outlive the group membership behind it — otherwise it
      // would grant access the outer boundary has already revoked.
      expect(
        await prisma.circleMember.findFirst({ where: { circleId: circle.id, userId: removed.id } })
      ).toBeNull();

      const after = await app.inject({
        method: 'GET',
        url: `/api/posts/${circlePostId}`,
        headers: authHeader(removed),
      });
      expect(after.statusCode).toBe(403);
    } finally {
      await prisma.user.delete({ where: { id: removed.id } });
    }
  });

  it('leaves circles in other families untouched', async () => {
    const other = await createGroup({ name: 'Unaffected Family' });
    const dual = await createUser({ name: 'Dual Member' });
    try {
      await addMember(group.id, dual.id);
      await addMember(other.id, dual.id);

      const otherCircle = await prisma.circle.create({
        data: { groupId: other.id, name: 'Other Circle', members: { create: [{ userId: dual.id }] } },
      });
      await prisma.circleMember.create({ data: { circleId: circle.id, userId: dual.id } });

      await app.inject({
        method: 'DELETE',
        url: `/api/admin/groups/${group.id}/members/${dual.id}`,
        headers: authHeader(admin),
      });

      // Only the removed family's circles are affected — the cascade is
      // scoped to circles of THAT group, not every circle the user is in.
      expect(await prisma.circleMember.findFirst({ where: { circleId: circle.id, userId: dual.id } })).toBeNull();
      expect(
        await prisma.circleMember.findFirst({ where: { circleId: otherCircle.id, userId: dual.id } })
      ).not.toBeNull();
    } finally {
      await prisma.group.delete({ where: { id: other.id } });
      await prisma.user.delete({ where: { id: dual.id } });
    }
  });
});

describe('circle discoverability', () => {
  it('lists only the caller own circles', async () => {
    const insiderRes = await app.inject({
      method: 'GET',
      url: `/api/circles?groupId=${group.id}`,
      headers: authHeader(insider),
    });
    expect(insiderRes.json().items.map((c: { id: string }) => c.id)).toEqual([circle.id]);

    // Fully private: an outsider gets an empty list, not a redacted entry.
    const outsiderRes = await app.inject({
      method: 'GET',
      url: `/api/circles?groupId=${group.id}`,
      headers: authHeader(outsider),
    });
    expect(outsiderRes.json().items).toEqual([]);
  });

  it('hides the member list from an outsider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/circles/${circle.id}/members`,
      headers: authHeader(outsider),
    });
    expect(res.statusCode).toBe(404);
  });

  it('shows the member list to an insider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/circles/${circle.id}/members`,
      headers: authHeader(insider),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(2);
  });
});

describe('admin access is management-only', () => {
  it('hides circle posts from admin content moderation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/content/posts?groupId=${group.id}`,
      headers: authHeader(admin),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(circlePostId);
    expect(ids).toContain(familyPostId);
  });

  it('does not let an admin outside the circle read the post directly', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/posts/${circlePostId}`, headers: authHeader(admin) });
    expect(res.statusCode).toBe(404);
  });

  it('refuses to delete a non-empty circle without explicit confirmation', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/circles/${circle.id}`,
      headers: authHeader(admin),
    });
    expect(res.statusCode).toBe(409);
    // The count is a number, never the content — it's what lets the UI warn.
    expect(res.json().postCount).toBeGreaterThan(0);
  });

  it('lets an admin manage circles they are not a member of', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/groups/${group.id}/circles`,
      headers: authHeader(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { id: string }) => c.id)).toContain(circle.id);
  });

  it('refuses to add someone who is not in the group', async () => {
    const stranger = await createUser({ name: 'Stranger' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/circles/${circle.id}/members`,
      headers: authHeader(admin),
      payload: { userId: stranger.id },
    });
    expect(res.statusCode).toBe(400);
    await prisma.user.delete({ where: { id: stranger.id } });
  });

  it('refuses circle management to a non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${group.id}/circles`,
      headers: authHeader(insider),
      payload: { name: 'Self-made' },
    });
    // No member-facing create route exists at all.
    expect(res.statusCode).toBe(404);

    const viaAdmin = await app.inject({
      method: 'POST',
      url: `/api/admin/groups/${group.id}/circles`,
      headers: authHeader(insider),
      payload: { name: 'Self-made' },
    });
    expect(viaAdmin.statusCode).toBe(403);
  });
});

describe('admin push surfaces respect the circle boundary', () => {
  // A push renders its excerpt on a lock screen, so leaking a circle post
  // here leaks the content itself, not merely that the post exists. Both of
  // these were missed on the first pass: the push subsystem derives its own
  // recipient lists and joins post content, so it doesn't inherit the feed's
  // filtering for free.
  it('hides circle posts from the push delivery log', async () => {
    await prisma.pushDeliveryLog.create({
      data: {
        postId: circlePostId,
        notifyType: 'new_post',
        recipientCount: 1,
        tokenCount: 1,
        successCount: 1,
        failureCount: 0,
      },
    });
    await prisma.pushDeliveryLog.create({
      data: {
        postId: familyPostId,
        notifyType: 'new_post',
        recipientCount: 1,
        tokenCount: 1,
        successCount: 1,
        failureCount: 0,
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/push-log', headers: authHeader(admin) });
    expect(res.statusCode).toBe(200);

    const body = JSON.stringify(res.json().items);
    // The post's content must not come back through the log's join.
    expect(body).not.toContain('Secret circle news');
    expect(body).toContain('Everyone can see this');
  });

  it('refuses to resend a circle post push for an admin outside the circle', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/content/posts/${circlePostId}/retrigger-push`,
      headers: authHeader(admin),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('circle deletion cascades', () => {
  it('permanently deletes the circle posts when confirmed', async () => {
    const doomed = await prisma.circle.create({
      data: { groupId: group.id, name: 'Doomed', members: { create: [{ userId: author.id }] } },
    });
    const post = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'about to vanish', circleId: doomed.id },
    });
    const doomedPostId = post.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/circles/${doomed.id}?deleteContent=true`,
      headers: authHeader(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedPostCount).toBe(1);

    // Hard delete, no soft-delete anywhere in Famlin — the row is gone.
    expect(await prisma.post.findUnique({ where: { id: doomedPostId } })).toBeNull();
  });
});
