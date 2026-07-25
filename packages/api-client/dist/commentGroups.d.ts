import type { Comment, ReactionType } from './types';
/** Mirrors MAX_COMMENT_ATTACHMENTS in the backend's types.ts. */
export declare const MAX_COMMENT_ATTACHMENTS = 10;
/**
 * The photos/videos a comment carries, as an array — regardless of whether
 * the server that produced it knows about `attachmentUrls` (multi) or only
 * the legacy `attachmentUrl` (single). Always read attachments through this
 * rather than touching either field, so a client stays compatible with an
 * older backend.
 */
export declare function commentAttachments(comment: Pick<Comment, 'attachmentUrl' | 'attachmentUrls'>): string[];
/**
 * A run of adjacent comments rendered as one card. Most groups hold exactly
 * one comment (`isBundle: false`) and render as they always have; a bundle
 * collapses several photo-only comments from the same author into a single
 * photo grid — the "posted five photos one at a time" case.
 */
export interface CommentGroup {
    /** Stable list key — the lead comment's id. */
    key: string;
    /** The comments in this group, oldest first. Length >= 1. */
    comments: Comment[];
    /** comments[0] — owns the author, the timestamp and the reply target. */
    lead: Comment;
    /** Every attachment across the group, in order, tagged with its comment. */
    attachments: {
        url: string;
        commentId: string;
    }[];
    /** True once the group merged more than one comment. */
    isBundle: boolean;
    /**
     * Reactions on the comment the card's reaction button acts on — NOT the sum
     * across the bundle. Summing counts one person twice when they reacted to
     * several photos of the same burst, and the responses carry counts rather
     * than reactor ids, so there's nothing to deduplicate by. Showing the
     * target's own count keeps the number and the button describing the same
     * thing.
     */
    likeCount: number;
    /** The first reaction the current user left anywhere in the group. */
    myReaction: ReactionType | null;
    /**
     * Which comment a reaction tap acts on: the one the user already reacted
     * to (so tapping again removes exactly that reaction), otherwise the lead.
     */
    reactionTargetId: string;
    /** createdAt of the newest comment in the group. */
    latestCreatedAt: string;
}
/**
 * Collapses runs of adjacent photo-only comments by the same author into one
 * group each, leaving every other comment as a group of one. Expects the
 * chronological order the API returns and preserves it — a bundle takes the
 * position of its first comment.
 */
export declare function groupCommentAttachments(comments: Comment[], options?: {
    windowMs?: number;
}): CommentGroup[];
