import type { Comment, ReactionType } from './types';

/** Mirrors MAX_COMMENT_ATTACHMENTS in the backend's types.ts. */
export const MAX_COMMENT_ATTACHMENTS = 10;

/**
 * The photos/videos a comment carries, as an array — regardless of whether
 * the server that produced it knows about `attachmentUrls` (multi) or only
 * the legacy `attachmentUrl` (single). Always read attachments through this
 * rather than touching either field, so a client stays compatible with an
 * older backend.
 */
export function commentAttachments(
  comment: Pick<Comment, 'attachmentUrl' | 'attachmentUrls'>
): string[] {
  if (comment.attachmentUrls?.length) return comment.attachmentUrls;
  return comment.attachmentUrl ? [comment.attachmentUrl] : [];
}

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
  attachments: { url: string; commentId: string }[];
  /** True once the group merged more than one comment. */
  isBundle: boolean;
  /** Summed across the group, so no reaction disappears behind the bundle. */
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

/** Two photo comments further apart than this are separate moments. */
const DEFAULT_BUNDLE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Only a photo-only, user-authored comment bundles. A comment with text keeps
 * its own card (bundling would bury what someone wrote), and a
 * handler-authored one (a TRIP check-in, an ALBUM photo) is never touched —
 * those have their own rendering and their own metadata.
 */
function isBundleable(comment: Comment): boolean {
  return !comment.content?.trim() && !comment.metadata && commentAttachments(comment).length > 0;
}

function canMerge(previous: Comment, next: Comment, windowMs: number): boolean {
  if (!isBundleable(previous) || !isBundleable(next)) return false;
  if (previous.authorId !== next.authorId) return false;
  // A bundle is one card in one place in the thread, so everything in it must
  // sit at the same level and be pinned to the same asset.
  if ((previous.parentId ?? null) !== (next.parentId ?? null)) return false;
  if ((previous.assetUrl ?? null) !== (next.assetUrl ?? null)) return false;
  const gap = new Date(next.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return Number.isFinite(gap) && Math.abs(gap) <= windowMs;
}

function toGroup(comments: Comment[]): CommentGroup {
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
export function groupCommentAttachments(
  comments: Comment[],
  options?: { windowMs?: number }
): CommentGroup[] {
  const windowMs = options?.windowMs ?? DEFAULT_BUNDLE_WINDOW_MS;
  const groups: Comment[][] = [];

  for (const comment of comments) {
    const current = groups[groups.length - 1];
    if (current && canMerge(current[current.length - 1], comment, windowMs)) {
      current.push(comment);
    } else {
      groups.push([comment]);
    }
  }

  return groups.map(toGroup);
}
