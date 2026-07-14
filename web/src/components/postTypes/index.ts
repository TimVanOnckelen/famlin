import { ComponentType } from 'react';
import { Post } from '@famlin/api-client';
import { PollCardBody } from './PollCardBody';

export interface PostTypeCardBodyProps {
  post: Post;
}

export interface PostTypeRenderer {
  CardBody: ComponentType<PostTypeCardBodyProps>;
}

// Registry mirroring the backend's PostTypeHandler registry
// (backend/src/services/postTypes/registry.ts): one entry per custom post
// type that needs extra UI beyond the plain `content` text every post
// already renders. PostCard looks up `post.type` here and, when present,
// renders the matched CardBody below the normal content — an unmatched or
// absent type (UPDATE, MILESTONE, or any future/unknown type) simply skips
// this and falls back to the plain-text rendering, which is the required
// forward-compat story for custom types older clients don't know about.
export const postTypeRenderers: Record<string, PostTypeRenderer> = {
  POLL: { CardBody: PollCardBody },
};
