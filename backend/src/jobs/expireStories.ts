import { deleteStoriesWithMedia } from '../services/stories.js';

// Runs every 10 minutes (see server.ts): hard-deletes every story whose 24h
// are up and that its author didn't pin — the row, its views, reactions and
// private replies (cascade), and its photo on disk. Member-facing reads
// already hide an expired, unpinned story the moment it expires (see
// liveOrPinnedWhere in services/stories.ts), so this job's cadence only
// decides how long the bytes linger, never who can see them.
//
// Idempotent: a crash midway leaves rows that simply match again next run.
export async function runExpireStoriesJob(now = new Date()): Promise<number> {
  return deleteStoriesWithMedia({ expiresAt: { lte: now }, pinnedAt: null });
}
