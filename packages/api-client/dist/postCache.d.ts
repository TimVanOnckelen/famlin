import { QueryClient } from '@tanstack/react-query';
import { Post } from './types';
export declare function patchPostInCaches(queryClient: QueryClient, postId: string, patch: (post: Post) => Post): void;
