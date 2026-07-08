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
  content: string;
  parentId?: string;
  mentionedUserIds?: string[];
  assetUrl?: string;
}

export async function createComment(postId: string, data: CreateCommentBody): Promise<Comment> {
  const response = await api.post<Comment>(`/posts/${postId}/comments`, data);
  return response.data;
}

export async function updateComment(commentId: string, content: string): Promise<Comment> {
  const response = await api.patch<Comment>(`/comments/${commentId}`, { content });
  return response.data;
}

export async function deleteComment(commentId: string): Promise<void> {
  await api.delete(`/comments/${commentId}`);
}

export async function reactToComment(commentId: string, type: ReactionType): Promise<ReactionResult> {
  const response = await api.post<ReactionResult>(`/comments/${commentId}/like`, { type });
  return response.data;
}
