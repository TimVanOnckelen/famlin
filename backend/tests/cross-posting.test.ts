import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/db.js'
import { buildTestApp, createUser, createGroupWithMember, addMember, authHeader } from './helpers.js'

// Cross-posting fans one write out into one Post row per target group,
// sharing Post.crossPostId — see routes/posts.ts's POST / and CLAUDE.md.
// Privacy rule under test throughout: crossPostId itself must never appear
// in any API response, and `sharedWithGroups` must only ever appear for the
// author's own view of the post.
describe('cross-posting', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('creates one Post row per target group sharing a crossPostId and identical createdAt', async () => {
    const author = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'hello both families' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).not.toHaveProperty('crossPostId')
    expect(body.sharedWithGroups).toHaveLength(2)
    expect(body.sharedWithGroups).toEqual(
      expect.arrayContaining([
        { id: groupA.id, name: groupA.name },
        { id: groupB.id, name: groupB.name },
      ])
    )

    const rows = await prisma.post.findMany({ where: { content: 'hello both families' } })
    expect(rows).toHaveLength(2)
    expect(rows[0].crossPostId).not.toBeNull()
    expect(rows[0].crossPostId).toBe(rows[1].crossPostId)
    expect(rows[0].createdAt.getTime()).toBe(rows[1].createdAt.getTime())
    expect(new Set(rows.map((r) => r.groupId))).toEqual(new Set([groupA.id, groupB.id]))
  })

  it('rejects a groupIds list containing a group the caller is not a member of, creating zero posts', async () => {
    const author = await createUser()
    const stranger = await createUser()
    const outsiderGroup = await createGroupWithMember(stranger)
    const groupA = await createGroupWithMember(author)

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, outsiderGroup.id], content: 'should not be created' },
    })

    expect(res.statusCode).toBe(403)

    const rows = await prisma.post.findMany({ where: { content: 'should not be created' } })
    expect(rows).toHaveLength(0)
  })

  it('still accepts the legacy single-groupId body, unaffected by cross-posting', async () => {
    const author = await createUser()
    const group = await createGroupWithMember(author)

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupId: group.id, content: 'legacy shape' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().content).toBe('legacy shape')
    expect(res.json().sharedWithGroups).toBeUndefined()

    const row = await prisma.post.findFirst({ where: { content: 'legacy shape' } })
    expect(row?.crossPostId).toBeNull()
  })

  it('keeps comments and likes stored per sibling', async () => {
    const author = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'isolated' },
    })
    expect(create.statusCode).toBe(200)

    const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'isolated' } })
    const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, content: 'isolated' } })

    const comment = await app.inject({
      method: 'POST',
      url: `/api/posts/${postA.id}/comments`,
      headers: authHeader(author),
      payload: { content: 'only on A' },
    })
    expect(comment.statusCode).toBe(200)

    const like = await app.inject({ method: 'POST', url: `/api/posts/${postA.id}/like`, headers: authHeader(author) })
    expect(like.statusCode).toBe(200)

    const commentsA = await app.inject({
      method: 'GET',
      url: `/api/posts/${postA.id}/comments`,
      headers: authHeader(author),
    })
    const commentsB = await app.inject({
      method: 'GET',
      url: `/api/posts/${postB.id}/comments`,
      headers: authHeader(author),
    })
    // Stored on A only, but the author belongs to both groups, so both
    // copies show the merged thread — see the merged-comments test below.
    expect(await prisma.comment.count({ where: { postId: postB.id } })).toBe(0)
    expect(commentsA.json()).toHaveLength(1)
    expect(commentsB.json()).toHaveLength(1)
    expect(commentsB.json()[0].postId).toBe(postB.id)

    const getA = await app.inject({ method: 'GET', url: `/api/posts/${postA.id}`, headers: authHeader(author) })
    const getB = await app.inject({ method: 'GET', url: `/api/posts/${postB.id}`, headers: authHeader(author) })
    // The Like row stays on A, but the author belongs to both groups, so
    // both copies show it — see the merged-reactions test below.
    expect(await prisma.like.count({ where: { postId: postA.id } })).toBe(1)
    expect(await prisma.like.count({ where: { postId: postB.id } })).toBe(0)
    expect(getA.json().likeCount).toBe(1)
    expect(getB.json().likeCount).toBe(1)
  })

  it('merges reactions across the siblings a viewer can see, and only those', async () => {
    const author = await createUser()
    const memberAOnly = await createUser()
    const memberBOnly = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await addMember(groupA.id, memberAOnly.id)
    await addMember(groupB.id, memberBOnly.id)

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'merged reactions' },
    })
    expect(create.statusCode).toBe(200)
    const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'merged reactions' } })
    const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, content: 'merged reactions' } })

    await app.inject({
      method: 'POST',
      url: `/api/posts/${postA.id}/like`,
      headers: authHeader(memberAOnly),
      payload: { type: 'LOVE' },
    })
    await app.inject({
      method: 'POST',
      url: `/api/posts/${postB.id}/like`,
      headers: authHeader(memberBOnly),
      payload: { type: 'HAHA' },
    })

    // The author sees one feed card carrying both families' reactions, and
    // the same on whichever sibling a notification opens.
    const feed = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(author) })
    const [card] = feed.json().items.filter((p: { content: string }) => p.content === 'merged reactions')
    expect(card.likeCount).toBe(2)
    expect(card.reactions).toEqual({ LOVE: 1, HAHA: 1 })
    expect(card.recentReactors.map((r: { id: string }) => r.id).sort()).toEqual([memberAOnly.id, memberBOnly.id].sort())
    for (const id of [postA.id, postB.id]) {
      const res = await app.inject({ method: 'GET', url: `/api/posts/${id}`, headers: authHeader(author) })
      expect(res.json().likeCount).toBe(2)
      const list = await app.inject({ method: 'GET', url: `/api/posts/${id}/reactions`, headers: authHeader(author) })
      expect(list.json().items).toHaveLength(2)
    }

    // A single-family member still only sees their own family's reactions.
    const aOnly = await app.inject({ method: 'GET', url: `/api/posts/${postA.id}`, headers: authHeader(memberAOnly) })
    expect(aOnly.json().reactions).toEqual({ LOVE: 1 })
    const bOnlyList = await app.inject({
      method: 'GET',
      url: `/api/posts/${postB.id}/reactions`,
      headers: authHeader(memberBOnly),
    })
    expect(bOnlyList.json().items.map((r: { id: string }) => r.id)).toEqual([memberBOnly.id])
  })

  it('merges comments across the siblings a viewer can see, and only those', async () => {
    const author = await createUser()
    const memberAOnly = await createUser()
    const memberBOnly = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await addMember(groupA.id, memberAOnly.id)
    await addMember(groupB.id, memberBOnly.id)

    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'merged comments' },
    })
    const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'merged comments' } })
    const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, content: 'merged comments' } })
    const comment = (user: Awaited<ReturnType<typeof createUser>>, postId: string, payload: object) =>
      app.inject({ method: 'POST', url: `/api/posts/${postId}/comments`, headers: authHeader(user), payload })
    const thread = async (user: Awaited<ReturnType<typeof createUser>>, postId: string) =>
      (await app.inject({ method: 'GET', url: `/api/posts/${postId}/comments`, headers: authHeader(user) })).json()

    await comment(memberAOnly, postA.id, { content: 'from A' })
    const fromB = (await comment(memberBOnly, postB.id, { content: 'from B' })).json()

    // The author sees one thread with both families' comments, on either copy.
    const authorThread = await thread(author, postA.id)
    expect(authorThread.map((c: { content: string }) => c.content)).toEqual(['from A', 'from B'])
    expect(authorThread.every((c: { postId: string }) => c.postId === postA.id)).toBe(true)
    expect(await thread(author, postB.id)).toHaveLength(2)
    const feed = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(author) })
    const [card] = feed.json().items.filter((p: { content: string }) => p.content === 'merged comments')
    expect(card.commentCount).toBe(2)

    // Replying from copy A to B's comment stores the reply with B's thread,
    // so B's family sees it and A-only members don't.
    const reply = await comment(author, postA.id, { content: 'reply', parentId: fromB.id })
    expect(reply.statusCode).toBe(200)
    expect(reply.json().postId).toBe(postA.id)
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: reply.json().id } })).postId).toBe(postB.id)
    expect((await thread(memberBOnly, postB.id)).map((c: { content: string }) => c.content)).toEqual([
      'from B',
      'reply',
    ])
    expect((await thread(memberAOnly, postA.id)).map((c: { content: string }) => c.content)).toEqual(['from A'])
    const aOnlyPost = await app.inject({
      method: 'GET',
      url: `/api/posts/${postA.id}`,
      headers: authHeader(memberAOnly),
    })
    expect(aOnlyPost.json().commentCount).toBe(1)

    // An A-only member can't reply onto B's comment through copy A.
    const sneaky = await comment(memberAOnly, postA.id, { content: 'nope', parentId: fromB.id })
    expect(sneaky.statusCode).toBe(404)
  })

  it("toggles the viewer's reaction wherever it lives across siblings", async () => {
    const author = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'toggle across' },
    })
    const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'toggle across' } })
    const postB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, content: 'toggle across' } })
    const react = (postId: string, type: string) =>
      app.inject({ method: 'POST', url: `/api/posts/${postId}/like`, headers: authHeader(author), payload: { type } })

    // Reacted on B, switched from A: changed in place on B, nothing added on A.
    expect((await react(postB.id, 'LOVE')).json().myReaction).toBe('LOVE')
    const switched = await react(postA.id, 'HAHA')
    expect(switched.json()).toEqual({ myReaction: 'HAHA', counts: { HAHA: 1 } })
    expect(await prisma.like.findMany({ where: { postId: { in: [postA.id, postB.id] } } })).toMatchObject([
      { postId: postB.id, type: 'HAHA' },
    ])

    // Same reaction again from A removes it from B.
    const removed = await react(postA.id, 'HAHA')
    expect(removed.json()).toEqual({ myReaction: null, counts: {} })
    expect(await prisma.like.count({ where: { postId: { in: [postA.id, postB.id] } } })).toBe(0)
  })

  it('dedupes the feed for a member of both target groups, and hides sharedWithGroups/crossPostId from a non-author', async () => {
    const author = await createUser()
    const memberBoth = await createUser()
    const memberBOnly = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await addMember(groupA.id, memberBoth.id)
    await addMember(groupB.id, memberBoth.id)
    await addMember(groupB.id, memberBOnly.id)

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'dedup test' },
    })
    expect(create.statusCode).toBe(200)

    const feedBoth = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(memberBoth) })
    const bothItems = feedBoth.json().items.filter((p: { content: string }) => p.content === 'dedup test')
    expect(bothItems).toHaveLength(1)

    const feedBOnly = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(memberBOnly) })
    const bOnlyItems = feedBOnly.json().items.filter((p: { content: string }) => p.content === 'dedup test')
    expect(bOnlyItems).toHaveLength(1)
    expect(bOnlyItems[0]).not.toHaveProperty('sharedWithGroups')
    expect(JSON.stringify(bOnlyItems[0])).not.toContain('crossPostId')

    const feedAuthor = await app.inject({ method: 'GET', url: '/api/posts', headers: authHeader(author) })
    const authorItems = feedAuthor.json().items.filter((p: { content: string }) => p.content === 'dedup test')
    expect(authorItems).toHaveLength(1)
    expect(authorItems[0].sharedWithGroups).toHaveLength(2)
  })

  it('PATCH by the author updates every sibling, and DELETE removes every sibling', async () => {
    const author = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'before edit' },
    })
    const postId = create.json().id

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/posts/${postId}`,
      headers: authHeader(author),
      payload: { content: 'after edit' },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().content).toBe('after edit')
    expect(patch.json().sharedWithGroups).toHaveLength(2)

    const rowsAfterEdit = await prisma.post.findMany({ where: { groupId: { in: [groupA.id, groupB.id] } } })
    expect(rowsAfterEdit).toHaveLength(2)
    expect(rowsAfterEdit.every((r) => r.content === 'after edit')).toBe(true)

    const del = await app.inject({ method: 'DELETE', url: `/api/posts/${postId}`, headers: authHeader(author) })
    expect(del.statusCode).toBe(200)

    const remaining = await prisma.post.count({ where: { groupId: { in: [groupA.id, groupB.id] } } })
    expect(remaining).toBe(0)
  })

  it('PATCH by an admin moderating edits only that one sibling, never the others', async () => {
    const author = await createUser()
    const admin = await createUser({ isAdmin: true })
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await addMember(groupA.id, admin.id)

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'original' },
    })
    const siblingA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, authorId: author.id } })
    expect(create.statusCode).toBe(200)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/posts/${siblingA.id}`,
      headers: authHeader(admin),
      payload: { content: 'moderated' },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().content).toBe('moderated')
    // The admin isn't the author, so the cross-post must stay invisible to them.
    expect(patch.json()).not.toHaveProperty('sharedWithGroups')
    expect(patch.json()).not.toHaveProperty('crossPostId')

    const siblingB = await prisma.post.findFirstOrThrow({ where: { groupId: groupB.id, authorId: author.id } })
    expect(siblingB.content).toBe('original')
  })

  it('PATCH by the author replaces the photos on every sibling', async () => {
    const author = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    const assetPath = () => `/uploads/${randomUUID()}.jpg`
    const [keep, drop, added] = [assetPath(), assetPath(), assetPath()]

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'photos', uploadedAssetUrls: [keep, drop] },
    })
    const postId = create.json().id

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/posts/${postId}`,
      headers: authHeader(author),
      payload: { uploadedAssetUrls: [keep, added] },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().uploadedAssetUrls).toEqual([keep, added])

    const rows = await prisma.post.findMany({ where: { groupId: { in: [groupA.id, groupB.id] } } })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.uploadedAssetUrls.join() === [keep, added].join())).toBe(true)
  })

  it('notifies each recipient exactly once even when they belong to every target group', async () => {
    const author = await createUser()
    const recipientBoth = await createUser()
    const recipientAOnly = await createUser()
    const recipientBOnly = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await addMember(groupA.id, recipientBoth.id)
    await addMember(groupB.id, recipientBoth.id)
    await addMember(groupA.id, recipientAOnly.id)
    await addMember(groupB.id, recipientBOnly.id)

    const res = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'notify once' },
    })
    expect(res.statusCode).toBe(200)

    const postA = await prisma.post.findFirstOrThrow({ where: { groupId: groupA.id, content: 'notify once' } })

    // Every recipient assertion polls together, because the notifications
    // subscriber walks event.posts sequentially and awaits one notifyUsers
    // per target group: groupA's recipients (recipientBoth, recipientAOnly)
    // commit in the first iteration, groupB's (recipientBOnly) in the
    // second. Polling on recipientBoth alone and then reading the others
    // bare raced the tail of that same dispatch, and failed in CI on
    // recipientBOnly's row not having landed yet.
    await vi.waitFor(async () => {
      const rows = await prisma.notification.findMany({ where: { userId: recipientBoth.id, type: 'new_post' } })
      expect(rows).toHaveLength(1)
      // Assigned to the FIRST event-post (groupA's, targets order) whose
      // group they belong to — not notified again for groupB.
      expect(rows[0].relatedPostId).toBe(postA.id)

      const aOnlyRows = await prisma.notification.findMany({ where: { userId: recipientAOnly.id, type: 'new_post' } })
      expect(aOnlyRows).toHaveLength(1)

      const bOnlyRows = await prisma.notification.findMany({ where: { userId: recipientBOnly.id, type: 'new_post' } })
      expect(bOnlyRows).toHaveLength(1)
    })

    // Safe to read bare: once every recipient row above has landed, the
    // dispatch for this event has finished, so the author having no row is a
    // settled outcome rather than a not-yet.
    const authorRows = await prisma.notification.findMany({ where: { userId: author.id, type: 'new_post' } })
    expect(authorRows).toHaveLength(0)
  })

  // GET /api/posts/search and GET /api/posts/on-this-day are single-group
  // endpoints (?groupId=), and cross-post creation (POST / above) creates at
  // most one Post row per target group, so a crossPostId can never repeat
  // within one group's results today — dedupeByCrossPostId there is
  // defensive. These two pairs of tests cover both the realistic path (a
  // real cross-post, once per group it targets) and, by inserting sibling
  // rows directly, the hypothetical a future change could reintroduce
  // (two rows sharing a crossPostId landing in the SAME group's results).
  it('shows a cross-posted post exactly once in search, for each group it targets', async () => {
    const author = await createUser()
    const memberBoth = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await addMember(groupA.id, memberBoth.id)
    await addMember(groupB.id, memberBoth.id)

    const create = await app.inject({
      method: 'POST',
      url: '/api/posts',
      headers: authHeader(author),
      payload: { groupIds: [groupA.id, groupB.id], content: 'searchable cross post text' },
    })
    expect(create.statusCode).toBe(200)

    for (const group of [groupA, groupB]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/search?groupId=${group.id}&q=searchable`,
        headers: authHeader(memberBoth),
      })
      expect(res.statusCode).toBe(200)
      const items = res.json().items.filter((p: { content: string }) => p.content === 'searchable cross post text')
      expect(items).toHaveLength(1)
    }
  })

  it('dedupes search results if a group ever holds two rows sharing a crossPostId', async () => {
    const author = await createUser()
    const group = await createGroupWithMember(author)
    const crossPostId = randomUUID()
    const createdAt = new Date()

    await prisma.post.createMany({
      data: [
        { authorId: author.id, groupId: group.id, content: 'duplicate sibling search text', crossPostId, createdAt },
        { authorId: author.id, groupId: group.id, content: 'duplicate sibling search text', crossPostId, createdAt },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/search?groupId=${group.id}&q=duplicate%20sibling`,
      headers: authHeader(author),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(1)
  })

  it('shows a cross-posted post exactly once in on-this-day, for each group it targets', async () => {
    const author = await createUser()
    const memberBoth = await createUser()
    const groupA = await createGroupWithMember(author)
    const groupB = await createGroupWithMember(author)
    await addMember(groupA.id, memberBoth.id)
    await addMember(groupB.id, memberBoth.id)

    const lastYear = new Date()
    lastYear.setFullYear(lastYear.getFullYear() - 1)

    const crossPostId = randomUUID()
    await prisma.post.createMany({
      data: [
        {
          authorId: author.id,
          groupId: groupA.id,
          content: 'on this day cross post',
          crossPostId,
          createdAt: lastYear,
        },
        {
          authorId: author.id,
          groupId: groupB.id,
          content: 'on this day cross post',
          crossPostId,
          createdAt: lastYear,
        },
      ],
    })

    for (const group of [groupA, groupB]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/posts/on-this-day?groupId=${group.id}`,
        headers: authHeader(memberBoth),
      })
      expect(res.statusCode).toBe(200)
      const items = res.json().items.filter((p: { content: string }) => p.content === 'on this day cross post')
      expect(items).toHaveLength(1)
    }
  })

  it('dedupes on-this-day results if a group ever holds two rows sharing a crossPostId', async () => {
    const author = await createUser()
    const group = await createGroupWithMember(author)
    const crossPostId = randomUUID()
    const lastYear = new Date()
    lastYear.setFullYear(lastYear.getFullYear() - 1)

    await prisma.post.createMany({
      data: [
        {
          authorId: author.id,
          groupId: group.id,
          content: 'duplicate sibling on this day',
          crossPostId,
          createdAt: lastYear,
        },
        {
          authorId: author.id,
          groupId: group.id,
          content: 'duplicate sibling on this day',
          crossPostId,
          createdAt: lastYear,
        },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/posts/on-this-day?groupId=${group.id}`,
      headers: authHeader(author),
    })
    expect(res.statusCode).toBe(200)
    const items = res.json().items.filter((p: { content: string }) => p.content === 'duplicate sibling on this day')
    expect(items).toHaveLength(1)
  })
})

describe('dedupeHandlerCommentCopies', () => {
  it("keeps the primary post's copy of a handler comment and re-parents replies to dropped copies", async () => {
    const { dedupeHandlerCommentCopies } = await import('../src/services/comments.js')
    const checkin = (id: string, postId: string) => ({
      id,
      postId,
      parentId: null,
      metadata: { kind: 'trip_checkin', checkinId: 'c1', place: 'Paris', photoUrls: [] },
    })
    const result = dedupeHandlerCommentCopies(
      [
        checkin('onB', 'B'),
        checkin('onA', 'A'),
        { id: 'replyOnB', postId: 'B', parentId: 'onB', metadata: null },
        { id: 'plain', postId: 'B', parentId: null, metadata: null },
      ],
      'A'
    )
    expect(result.map((c) => c.id)).toEqual(['onA', 'replyOnB', 'plain'])
    expect(result.find((c) => c.id === 'replyOnB')!.parentId).toBe('onA')
  })
})
