"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchPostInCaches = patchPostInCaches;
// Applies `patch` to a post by id everywhere it may be cached: every
// useInfiniteQuery cache under the ['posts', ...] key (the feed, one per
// group), the ['favorites'] infinite-query cache, and the single-post
// ['post', postId] cache. All of these store `{ pages: [{ items, nextCursor }] }`
// (InfiniteData), not a bare Post[], so callers must go through this helper
// rather than assuming a flat array shape.
function patchPostInCaches(queryClient, postId, patch) {
    const patchPage = (page) => ({
        ...page,
        items: page.items.map((p) => (p.id === postId ? patch(p) : p)),
    });
    queryClient.setQueriesData({ queryKey: ['posts'] }, (old) => old ? { ...old, pages: old.pages.map(patchPage) } : old);
    queryClient.setQueriesData({ queryKey: ['favorites'] }, (old) => old ? { ...old, pages: old.pages.map(patchPage) } : old);
    queryClient.setQueryData(['post', postId], (old) => (old ? patch(old) : old));
}
