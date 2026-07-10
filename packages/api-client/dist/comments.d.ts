import { Comment, ReactionType } from './types';
import { ReactionResult } from './posts';
export declare function fetchComments(postId: string, assetUrl?: string): Promise<Comment[]>;
export interface CreateCommentBody {
    content?: string;
    parentId?: string;
    mentionedUserIds?: string[];
    assetUrl?: string;
    attachmentUrl?: string;
}
export declare function createComment(postId: string, data: CreateCommentBody): Promise<Comment>;
export declare function updateComment(commentId: string, content: string): Promise<Comment>;
export declare function deleteComment(commentId: string): Promise<void>;
export declare function reactToComment(commentId: string, type: ReactionType): Promise<ReactionResult>;
