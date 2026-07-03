import { QueryClient } from '@tanstack/react-query';
import { Post } from '@/types';

type PostsPage = { items: Post[]; nextCursor: string | null };
type InfinitePosts = { pages: PostsPage[]; pageParams: unknown[] };

// Applies `patch` to a post by id everywhere it may be cached: every
// useInfiniteQuery cache under the ['posts', ...] key (the feed, one per
// group), the ['favorites'] infinite-query cache, and the single-post
// ['post', postId] cache. All of these store `{ pages: [{ items, nextCursor }] }`
// (InfiniteData), not a bare Post[], so callers must go through this helper
// rather than assuming a flat array shape.
export function patchPostInCaches(queryClient: QueryClient, postId: string, patch: (post: Post) => Post) {
  const patchPage = (page: PostsPage): PostsPage => ({
    ...page,
    items: page.items.map((p) => (p.id === postId ? patch(p) : p)),
  });

  queryClient.setQueriesData<InfinitePosts>({ queryKey: ['posts'] }, (old) =>
    old ? { ...old, pages: old.pages.map(patchPage) } : old
  );
  queryClient.setQueriesData<InfinitePosts>({ queryKey: ['favorites'] }, (old) =>
    old ? { ...old, pages: old.pages.map(patchPage) } : old
  );
  queryClient.setQueryData<Post>(['post', postId], (old) => (old ? patch(old) : old));
}
