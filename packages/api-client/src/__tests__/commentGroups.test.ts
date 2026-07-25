import { describe, it, expect } from 'vitest';

import { commentAttachments, groupCommentAttachments } from '../commentGroups';
import type { Comment } from '../types';

const BASE_TIME = Date.parse('2026-07-25T10:00:00.000Z');

function makeComment(overrides: Partial<Comment> & { id: string }): Comment {
  return {
    postId: 'post-1',
    authorId: 'user-1',
    author: { id: 'user-1', name: 'Tim', avatarUrl: null },
    content: '',
    createdAt: new Date(BASE_TIME).toISOString(),
    parentId: null,
    assetUrl: null,
    attachmentUrl: null,
    attachmentUrls: [],
    metadata: null,
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    ...overrides,
  };
}

/** A photo-only comment `minutesAfter` minutes into the thread. */
function photoComment(id: string, minutesAfter: number, overrides: Partial<Comment> = {}): Comment {
  return makeComment({
    id,
    attachmentUrls: [`/uploads/${id}.jpg`],
    attachmentUrl: `/uploads/${id}.jpg`,
    createdAt: new Date(BASE_TIME + minutesAfter * 60_000).toISOString(),
    ...overrides,
  });
}

describe('commentAttachments', () => {
  it('reads attachmentUrls when present', () => {
    const comment = makeComment({ id: 'c1', attachmentUrls: ['/uploads/a.jpg', '/uploads/b.jpg'] });
    expect(commentAttachments(comment)).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
  });

  it('falls back to the legacy attachmentUrl (older server, no attachmentUrls)', () => {
    const comment = makeComment({ id: 'c1', attachmentUrl: '/uploads/a.jpg', attachmentUrls: undefined });
    expect(commentAttachments(comment)).toEqual(['/uploads/a.jpg']);
  });

  it('is empty for a text-only comment', () => {
    expect(commentAttachments(makeComment({ id: 'c1', content: 'hi' }))).toEqual([]);
  });
});

describe('groupCommentAttachments', () => {
  it('bundles adjacent photo-only comments from the same author', () => {
    const groups = groupCommentAttachments([
      photoComment('c1', 0),
      photoComment('c2', 1),
      photoComment('c3', 2),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].isBundle).toBe(true);
    expect(groups[0].lead.id).toBe('c1');
    expect(groups[0].attachments.map((a) => a.url)).toEqual([
      '/uploads/c1.jpg',
      '/uploads/c2.jpg',
      '/uploads/c3.jpg',
    ]);
    expect(groups[0].latestCreatedAt).toBe(photoComment('c3', 2).createdAt);
  });

  it('flattens a multi-photo comment into the same bundle', () => {
    const groups = groupCommentAttachments([
      photoComment('c1', 0, { attachmentUrls: ['/uploads/a.jpg', '/uploads/b.jpg'] }),
      photoComment('c2', 1),
    ]);

    expect(groups[0].attachments.map((a) => a.url)).toEqual([
      '/uploads/a.jpg',
      '/uploads/b.jpg',
      '/uploads/c2.jpg',
    ]);
    expect(groups[0].attachments[1].commentId).toBe('c1');
  });

  it('keeps a single multi-photo comment as a non-bundle group', () => {
    const groups = groupCommentAttachments([
      photoComment('c1', 0, { attachmentUrls: ['/uploads/a.jpg', '/uploads/b.jpg'] }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].isBundle).toBe(false);
    expect(groups[0].attachments).toHaveLength(2);
  });

  it('never merges a comment that has text', () => {
    const groups = groupCommentAttachments([
      photoComment('c1', 0),
      photoComment('c2', 1, { content: 'look at this' }),
      photoComment('c3', 2),
    ]);

    expect(groups.map((g) => g.comments.map((c) => c.id))).toEqual([['c1'], ['c2'], ['c3']]);
  });

  it('never merges a handler-authored comment (trip check-in / album photo)', () => {
    const groups = groupCommentAttachments([
      photoComment('c1', 0),
      photoComment('c2', 1, {
        metadata: { kind: 'trip_checkin', checkinId: 'x', place: 'Rome', photoUrls: [] },
      }),
      photoComment('c3', 2),
    ]);

    expect(groups.map((g) => g.comments.map((c) => c.id))).toEqual([['c1'], ['c2'], ['c3']]);
  });

  it('splits on a different author, a different thread level, and a different pinned asset', () => {
    const groups = groupCommentAttachments([
      photoComment('c1', 0),
      photoComment('c2', 1, { authorId: 'user-2' }),
      photoComment('c3', 2, { parentId: 'c1' }),
      photoComment('c4', 3, { assetUrl: '/uploads/post-photo.jpg' }),
    ]);

    expect(groups.map((g) => g.comments.map((c) => c.id))).toEqual([['c1'], ['c2'], ['c3'], ['c4']]);
  });

  it('splits when the gap exceeds the bundling window', () => {
    const groups = groupCommentAttachments([photoComment('c1', 0), photoComment('c2', 30)]);
    expect(groups.map((g) => g.comments.map((c) => c.id))).toEqual([['c1'], ['c2']]);
  });

  it('sums reactions and targets the comment the user already reacted to', () => {
    const groups = groupCommentAttachments([
      photoComment('c1', 0, { likeCount: 2 }),
      photoComment('c2', 1, { likeCount: 1, likedByMe: true, myReaction: 'LOVE' }),
      photoComment('c3', 2, { likeCount: 3, likedByMe: true, myReaction: 'LIKE' }),
    ]);

    expect(groups[0].likeCount).toBe(6);
    expect(groups[0].myReaction).toBe('LOVE');
    expect(groups[0].reactionTargetId).toBe('c2');
  });

  it('targets the lead comment when the user has not reacted', () => {
    const groups = groupCommentAttachments([photoComment('c1', 0), photoComment('c2', 1)]);
    expect(groups[0].myReaction).toBeNull();
    expect(groups[0].reactionTargetId).toBe('c1');
  });

  it('leaves ordinary text comments as groups of one, in order', () => {
    const groups = groupCommentAttachments([
      makeComment({ id: 'c1', content: 'hello' }),
      makeComment({ id: 'c2', content: 'hi there', authorId: 'user-2' }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['c1', 'c2']);
    expect(groups.every((g) => !g.isBundle)).toBe(true);
  });
});
