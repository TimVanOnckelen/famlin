import type { z } from 'zod';

// Thrown for expected, user-facing post-type validation/interaction failures
// so routes can map them to a translated message instead of leaking
// internals via err.message (same pattern as MediaProviderError in
// services/media/types.ts). `code` is an i18n error key suffix — e.g.
// 'pollClosed' -> t('errors.pollClosed') — and always maps to HTTP 400.
export class PostTypeError extends Error {
  constructor(
    public code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'PostTypeError';
  }
}

// One post type's behavior — UPDATE/MILESTONE/POLL today, more later (RSVP,
// ...). One file per type in this directory, registered in ./registry.ts
// (mirrors services/media/'s MediaProvider contract/registry pattern).
//
// Contract notes:
// - `content` stays the universal human-readable field for every type (a
//   poll's question, for instance) — a type's own config lives in typeData
//   instead, so search/notifications/old clients never need to know about it.
// - typeDataSchema validates only the CLIENT-SENT shape at create time; a
//   type with no schema must never receive typeData (see routes/posts.ts).
// - transformCreate/validateCreate only ever run once, at creation — type
//   and typeData are immutable afterward (updatePostBodySchema doesn't
//   accept either).
export interface PostTypeHandler {
  /** Stable persisted id — 'UPDATE' | 'MILESTONE' | 'POLL' | ... Never rename once deployed. */
  id: string;
  /** Zod schema for the CLIENT-SENT typeData at create time. Absent = typeData must be null/undefined. */
  typeDataSchema?: z.ZodTypeAny;
  /** Semantic validation beyond zod (e.g. poll requires non-empty content). Throw PostTypeError. */
  validateCreate?(args: { content: string | null | undefined; typeData: unknown }): void | Promise<void>;
  /** Transform client typeData into the persisted form (e.g. assign option ids). Returns what gets stored. */
  transformCreate?(typeData: unknown): unknown;
  /** Handle POST /api/posts/:postId/interactions for a post of this type. Throw PostTypeError for bad key/value/state. */
  interact?(args: { post: { id: string; typeData: unknown }; userId: string; key: string; value: unknown }): Promise<void>;
  /** Batch-attach computed fields to already-shaped posts of this type (mutate in place). ONE query per page, no N+1. */
  enrichPosts?(posts: Array<Record<string, any> & { id: string; typeData?: unknown }>, viewerId: string): Promise<void>;
}
