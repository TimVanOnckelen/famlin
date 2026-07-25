"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_COMMENT_ATTACHMENTS = void 0;
exports.commentAttachments = commentAttachments;
exports.groupCommentAttachments = groupCommentAttachments;
/** Mirrors MAX_COMMENT_ATTACHMENTS in the backend's types.ts. */
exports.MAX_COMMENT_ATTACHMENTS = 10;
/**
 * The photos/videos a comment carries, as an array — regardless of whether
 * the server that produced it knows about `attachmentUrls` (multi) or only
 * the legacy `attachmentUrl` (single). Always read attachments through this
 * rather than touching either field, so a client stays compatible with an
 * older backend.
 */
function commentAttachments(comment) {
    if (comment.attachmentUrls?.length)
        return comment.attachmentUrls;
    return comment.attachmentUrl ? [comment.attachmentUrl] : [];
}
/** Two photo comments further apart than this are separate moments. */
const DEFAULT_BUNDLE_WINDOW_MS = 10 * 60 * 1000;
/**
 * Only a photo-only, user-authored comment bundles. A comment with text keeps
 * its own card (bundling would bury what someone wrote), and a
 * handler-authored one (a TRIP check-in, an ALBUM photo) is never touched —
 * those have their own rendering and their own metadata.
 */
function isBundleable(comment) {
    return !comment.content?.trim() && !comment.metadata && commentAttachments(comment).length > 0;
}
function canMerge(previous, next, windowMs) {
    if (!isBundleable(previous) || !isBundleable(next))
        return false;
    if (previous.authorId !== next.authorId)
        return false;
    // A bundle is one card in one place in the thread, so everything in it must
    // sit at the same level and be pinned to the same asset.
    if ((previous.parentId ?? null) !== (next.parentId ?? null))
        return false;
    if ((previous.assetUrl ?? null) !== (next.assetUrl ?? null))
        return false;
    const gap = new Date(next.createdAt).getTime() - new Date(previous.createdAt).getTime();
    return Number.isFinite(gap) && Math.abs(gap) <= windowMs;
}
function toGroup(comments) {
    const lead = comments[0];
    const reacted = comments.find((c) => c.myReaction);
    return {
        key: lead.id,
        comments,
        lead,
        attachments: comments.flatMap((c) => commentAttachments(c).map((url) => ({ url, commentId: c.id }))),
        isBundle: comments.length > 1,
        likeCount: comments.reduce((sum, c) => sum + c.likeCount, 0),
        myReaction: reacted?.myReaction ?? null,
        reactionTargetId: reacted?.id ?? lead.id,
        latestCreatedAt: comments[comments.length - 1].createdAt,
    };
}
/**
 * Collapses runs of adjacent photo-only comments by the same author into one
 * group each, leaving every other comment as a group of one. Expects the
 * chronological order the API returns and preserves it — a bundle takes the
 * position of its first comment.
 */
function groupCommentAttachments(comments, options) {
    const windowMs = options?.windowMs ?? DEFAULT_BUNDLE_WINDOW_MS;
    const groups = [];
    for (const comment of comments) {
        const current = groups[groups.length - 1];
        if (current && canMerge(current[current.length - 1], comment, windowMs)) {
            current.push(comment);
        }
        else {
            groups.push([comment]);
        }
    }
    return groups.map(toGroup);
}
