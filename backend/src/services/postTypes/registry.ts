import type { PostTypeHandler } from './types.js';
import { updateHandler } from './update.js';
import { milestoneHandler } from './milestone.js';
import { pollHandler } from './poll.js';

// The static post-type registry — adding a custom post type (an RSVP, ...) =
// implement PostTypeHandler in a new file in this directory and add it here.
// Post.type stores these ids, so they must never be renamed once a
// deployment has posts of that type. Mirrors services/media/registry.ts.
const handlers = new Map<string, PostTypeHandler>([
  [updateHandler.id, updateHandler],
  [milestoneHandler.id, milestoneHandler],
  [pollHandler.id, pollHandler],
]);

export function getPostTypeHandler(id: string): PostTypeHandler | undefined {
  return handlers.get(id);
}

export function listPostTypeHandlers(): PostTypeHandler[] {
  return [...handlers.values()];
}

// A group's effective allowed post types (Group.allowedPostTypes): the empty
// array means "all registered types" — same convention as the allowedEmails
// setting — and a stored id whose handler was since removed from the
// registry is silently dropped (the row is harmless to keep, mirrors
// createMediaPersonLinkBodySchema's reasoning in src/types.ts).
// Member-facing group responses expose THIS resolved list (never empty), so
// clients don't need to know the registry; only admin responses expose the
// raw stored array, so the admin UI can distinguish "all" from an explicit
// list.
export function resolveAllowedPostTypes(group: { allowedPostTypes: string[] }): string[] {
  if (group.allowedPostTypes.length === 0) {
    return listPostTypeHandlers().map((handler) => handler.id);
  }
  return group.allowedPostTypes.filter((id) => handlers.has(id));
}

// Test-only escape hatch (mirrors __registerMediaProviderForTests in
// services/media/registry.ts): lets a test register a fake PostTypeHandler
// and remove it afterwards so it can't leak into other test files.
export function __registerPostTypeHandlerForTests(handler: PostTypeHandler): void {
  handlers.set(handler.id, handler);
}

export function __unregisterPostTypeHandlerForTests(id: string): void {
  handlers.delete(id);
}

export { PostTypeError } from './types.js';
export type { PostTypeHandler } from './types.js';
