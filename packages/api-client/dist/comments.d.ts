import { QueryClient } from '@tanstack/react-query';
import { Comment, ReactionType } from './types';
import { ReactionResult } from './posts';
export declare function fetchComments(postId: string, assetUrl?: string): Promise<Comment[]>;
export interface CommentsPage {
    items: Comment[];
    nextCursor: string | null;
}
export declare const COMMENTS_PAGE_SIZE = 30;
export declare const pagedCommentsQueryKey: (postId: string) => readonly ['comments', string, 'paged'];
export declare function fetchCommentsPage(postId: string, options?: {
    cursor?: string | null;
    take?: number;
    assetUrl?: string;
}): Promise<CommentsPage>;
export declare function flattenCommentPages(pages: readonly CommentsPage[]): Comment[];
export declare function patchCommentInCaches(queryClient: QueryClient, postId: string, commentId: string, patch: (comment: Comment) => Comment): void;
export declare function addCommentToCaches(queryClient: QueryClient, postId: string, comment: Comment): void;
export interface CreateCommentBody {
    content?: string;
    parentId?: string;
    mentionedUserIds?: string[];
    assetUrl?: string;
    attachmentUrl?: string;
    attachmentUrls?: string[];
}
export declare function createComment(postId: string, data: CreateCommentBody): Promise<Comment>;
export interface UpdateCommentBody {
    content?: string;
    attachmentUrl?: string;
    attachmentUrls?: string[];
}
export declare function updateComment(commentId: string, data: UpdateCommentBody): Promise<Comment>;
export declare function deleteComment(commentId: string): Promise<void>;
export declare function reactToComment(commentId: string, type: ReactionType): Promise<ReactionResult>;
