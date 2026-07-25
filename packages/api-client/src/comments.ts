import { api } from './client';
import { Comment, ReactionType } from './types';
import { ReactionResult } from './posts';

export async function fetchComments(postId: string, assetUrl?: string): Promise<Comment[]> {
  const response = await api.get<Comment[]>(`/posts/${postId}/comments`, {
    params: assetUrl ? { assetUrl } : undefined,
  });
  return response.data;
}

export interface CreateCommentBody {
  // Optional so a comment can be photo/video-only — the server rejects a
  // request with neither content nor attachments.
  content?: string;
  parentId?: string;
  mentionedUserIds?: string[];
  assetUrl?: string;
  // Photos/videos the commenter uploaded as part of this comment itself
  // (from POST /api/uploads) — distinct from assetUrl above. attachmentUrl is
  // the legacy single-attachment field; send attachmentUrls (max
  // MAX_COMMENT_ATTACHMENTS), which wins when the server understands it.
  attachmentUrl?: string;
  attachmentUrls?: string[];
}

export async function createComment(postId: string, data: CreateCommentBody): Promise<Comment> {
  const response = await api.post<Comment>(`/posts/${postId}/comments`, data);
  return response.data;
}

export interface UpdateCommentBody {
  content?: string;
  // The comment's complete attachment list after the edit — send it to add or
  // remove photos (it replaces the stored list wholesale), omit it to leave
  // them untouched. The two fields are independent, but the server rejects an
  // edit that would leave the comment with neither text nor photos.
  // A handler-authored comment (a TRIP check-in, an ALBUM contribution) keeps
  // its photos elsewhere and rejects attachment edits — text only there.
  attachmentUrl?: string;
  attachmentUrls?: string[];
}

export async function updateComment(commentId: string, data: UpdateCommentBody): Promise<Comment> {
  const response = await api.patch<Comment>(`/comments/${commentId}`, data);
  return response.data;
}

export async function deleteComment(commentId: string): Promise<void> {
  await api.delete(`/comments/${commentId}`);
}

export async function reactToComment(commentId: string, type: ReactionType): Promise<ReactionResult> {
  const response = await api.post<ReactionResult>(`/comments/${commentId}/like`, { type });
  return response.data;
}
