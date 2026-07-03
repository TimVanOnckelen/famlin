import { QueryClient } from '@tanstack/react-query';
import { patchPostInCaches } from '@/utils/postCache';
import { Post } from '@/types';

function makePost(overrides: Partial<Post>): Post {
  return {
    id: 'p1',
    authorId: 'u1',
    author: { id: 'u1', name: 'Alice' },
    groupId: 'g1',
    content: 'hello',
    type: 'UPDATE',
    uploadedAssetUrls: [],
    createdAt: new Date().toISOString(),
    commentCount: 0,
    likeCount: 0,
    likedByMe: false,
    myReaction: null,
    reactions: {},
    favoritedByMe: false,
    ...overrides,
  };
}

describe('patchPostInCaches', () => {
  let queryClient: QueryClient;
  let post1: Post;
  let post2: Post;

  beforeEach(() => {
    queryClient = new QueryClient();
    post1 = makePost({ id: 'post-1', likeCount: 2, likedByMe: false });
    post2 = makePost({ id: 'post-2', likeCount: 5, likedByMe: true });

    // (a) feed InfiniteData under ['posts', 'g1']
    queryClient.setQueryData(['posts', 'g1'], {
      pages: [{ items: [post1, post2], nextCursor: null }],
      pageParams: [undefined],
    });

    // (b) favorites InfiniteData, same page shape as FavoritesScreen's useInfiniteQuery
    queryClient.setQueryData(['favorites'], {
      pages: [{ items: [post1], nextCursor: null }],
      pageParams: [undefined],
    });

    // (c) single-post cache
    queryClient.setQueryData(['post', post1.id], post1);
  });

  afterEach(() => {
    // QueryClient schedules an unref'd-by-default gc setTimeout per cache
    // entry; clear() disposes all entries (and their timers) so Jest can
    // exit promptly instead of waiting out react-query's default 5 minute gcTime.
    queryClient.clear();
  });

  it('patches the post by id in the feed InfiniteData cache without corrupting its shape', () => {
    patchPostInCaches(queryClient, 'post-1', (p) => ({ ...p, likedByMe: true, likeCount: p.likeCount + 1 }));

    const feedData = queryClient.getQueryData<any>(['posts', 'g1']);
    expect(feedData.pages).toHaveLength(1);
    expect(feedData.pages[0].nextCursor).toBeNull();
    expect(feedData.pages[0].items).toHaveLength(2);

    const patched = feedData.pages[0].items.find((p: Post) => p.id === 'post-1');
    expect(patched.likedByMe).toBe(true);
    expect(patched.likeCount).toBe(3);

    // Untouched post in the same page is unaffected.
    const untouched = feedData.pages[0].items.find((p: Post) => p.id === 'post-2');
    expect(untouched.likeCount).toBe(5);
    expect(untouched.likedByMe).toBe(true);
  });

  it('patches the same post in the favorites InfiniteData cache', () => {
    patchPostInCaches(queryClient, 'post-1', (p) => ({ ...p, likedByMe: true, likeCount: p.likeCount + 1 }));

    const favData = queryClient.getQueryData<any>(['favorites']);
    expect(favData.pages[0].items).toHaveLength(1);
    expect(favData.pages[0].items[0].likedByMe).toBe(true);
    expect(favData.pages[0].items[0].likeCount).toBe(3);
  });

  it('patches the single-post cache', () => {
    patchPostInCaches(queryClient, 'post-1', (p) => ({ ...p, likedByMe: true, likeCount: p.likeCount + 1 }));

    const single = queryClient.getQueryData<Post>(['post', 'post-1']);
    expect(single?.likedByMe).toBe(true);
    expect(single?.likeCount).toBe(3);
  });

  it('is a no-op for an id that does not exist in any cache, and never throws on InfiniteData', () => {
    expect(() => patchPostInCaches(queryClient, 'unknown-id', (p) => ({ ...p, likedByMe: true }))).not.toThrow();

    const feedData = queryClient.getQueryData<any>(['posts', 'g1']);
    expect(feedData.pages[0].items.map((p: Post) => [p.id, p.likedByMe, p.likeCount])).toEqual([
      ['post-1', false, 2],
      ['post-2', true, 5],
    ]);

    const favData = queryClient.getQueryData<any>(['favorites']);
    expect(favData.pages[0].items[0].likedByMe).toBe(false);

    // Single-post cache for a different id stays undefined (never created).
    expect(queryClient.getQueryData(['post', 'unknown-id'])).toBeUndefined();
  });

  it('does nothing when a cache is entirely absent (e.g. no favorites query has ever run)', () => {
    const freshClient = new QueryClient();
    freshClient.setQueryData(['post', 'post-1'], post1);

    expect(() => patchPostInCaches(freshClient, 'post-1', (p) => ({ ...p, likeCount: 99 }))).not.toThrow();
    expect(freshClient.getQueryData(['posts', 'g1'])).toBeUndefined();
    expect(freshClient.getQueryData(['favorites'])).toBeUndefined();
    expect(freshClient.getQueryData<Post>(['post', 'post-1'])?.likeCount).toBe(99);
    freshClient.clear();
  });
});
