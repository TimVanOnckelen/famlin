import { ComponentType } from 'react';

import { Post } from '@/types';
import { PollBody } from '@/components/PollBody';

export interface PostTypeCardBodyProps {
  post: Post;
}

export interface PostTypeRenderer {
  CardBody: ComponentType<PostTypeCardBodyProps>;
}

// Light renderer registry mirroring the backend's PostTypeHandler registry
// (backend/src/services/postTypes/registry.ts): one entry per custom post
// type, keyed by the persisted `Post.type` string. PostCard/PostDetailScreen
// look up `post.type` here and render the entry's CardBody below their normal
// content; a type with no entry here (including UPDATE/MILESTONE, which stay
// hardcoded in those callers) simply renders nothing extra — that fallback is
// required for forward-compat with post types this app build doesn't know
// about yet. Do NOT add UPDATE/MILESTONE here, they are not part of this
// registry.
export const postTypeRenderers: Record<string, PostTypeRenderer> = {
  POLL: { CardBody: PollBody },
};
