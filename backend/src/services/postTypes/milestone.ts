import type { PostTypeHandler } from './types.js';

// A milestone post — milestoneTag is its own legacy top-level Post column
// (untouched by this framework), so this handler carries no typeData of its
// own. No typeDataSchema means typeData is rejected for MILESTONE too.
export const milestoneHandler: PostTypeHandler = {
  id: 'MILESTONE',
};
