import type { PostTypeHandler } from './types.js';

// The default post type — a plain text/photo update with no type-specific
// config. No typeDataSchema means a route sending typeData for an UPDATE
// post gets rejected (see routes/posts.ts POST /).
export const updateHandler: PostTypeHandler = {
  id: 'UPDATE',
};
