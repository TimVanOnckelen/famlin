"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pagedCommentsQueryKey = exports.COMMENTS_PAGE_SIZE = void 0;
exports.fetchComments = fetchComments;
exports.fetchCommentsPage = fetchCommentsPage;
exports.flattenCommentPages = flattenCommentPages;
exports.patchCommentInCaches = patchCommentInCaches;
exports.addCommentToCaches = addCommentToCaches;
exports.createComment = createComment;
exports.updateComment = updateComment;
exports.deleteComment = deleteComment;
exports.reactToComment = reactToComment;
const client_1 = require("./client");
async function fetchComments(postId, assetUrl) {
    const response = await client_1.api.get(`/posts/${postId}/comments`, {
        params: assetUrl ? { assetUrl } : undefined,
    });
    return response.data;
}
exports.COMMENTS_PAGE_SIZE = 30;
// The useInfiniteQuery key for a post's paged thread. Deliberately a child of
// ['comments', postId], so every existing invalidation of that prefix (after
// a check-in, an album upload, a delete) refetches the paged thread too.
const pagedCommentsQueryKey = (postId) => ['comments', postId, 'paged'];
exports.pagedCommentsQueryKey = pagedCommentsQueryKey;
async function fetchCommentsPage(postId, options = {}) {
    const response = await client_1.api.get(`/posts/${postId}/comments`, {
        params: {
            take: options.take ?? exports.COMMENTS_PAGE_SIZE,
            ...(options.cursor ? { cursor: options.cursor } : {}),
            ...(options.assetUrl ? { assetUrl: options.assetUrl } : {}),
        },
    });
    const data = response.data;
    return Array.isArray(data) ? { items: data, nextCursor: null } : data;
}
// A paged thread in display order: oldest first, each comment once (a page
// refetched after new comments arrived can overlap the one before it).
function flattenCommentPages(pages) {
    const byId = new Map();
    for (const page of pages)
        for (const comment of page.items)
            byId.set(comment.id, comment);
    return [...byId.values()].sort((a, b) => a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1);
}
// Applies `patch` to one comment in both caches a post's thread can live in:
// the flat ['comments', postId] list (fetchComments — trip and album pages)
// and the paged thread (pagedCommentsQueryKey).
function patchCommentInCaches(queryClient, postId, commentId, patch) {
    const apply = (comment) => (comment.id === commentId ? patch(comment) : comment);
    queryClient.setQueryData(['comments', postId], (old) => old?.map(apply));
    queryClient.setQueryData((0, exports.pagedCommentsQueryKey)(postId), (old) => old ? { ...old, pages: old.pages.map((page) => ({ ...page, items: page.items.map(apply) })) } : old);
}
// Adds a just-created comment to both caches — on the paged thread, to the
// newest page, which is where the server would put it on a refetch.
function addCommentToCaches(queryClient, postId, comment) {
    queryClient.setQueryData(['comments', postId], (old) => (old ? [...old, comment] : old));
    queryClient.setQueryData((0, exports.pagedCommentsQueryKey)(postId), (old) => old && old.pages.length > 0
        ? {
            ...old,
            pages: [{ ...old.pages[0], items: [comment, ...old.pages[0].items] }, ...old.pages.slice(1)],
        }
        : old);
}
async function createComment(postId, data) {
    const response = await client_1.api.post(`/posts/${postId}/comments`, data);
    return response.data;
}
async function updateComment(commentId, data) {
    const response = await client_1.api.patch(`/comments/${commentId}`, data);
    return response.data;
}
async function deleteComment(commentId) {
    await client_1.api.delete(`/comments/${commentId}`);
}
async function reactToComment(commentId, type) {
    const response = await client_1.api.post(`/comments/${commentId}/like`, { type });
    return response.data;
}
