// Shared helpers for detecting Prisma's known-request error codes without
// importing `Prisma.PrismaClientKnownRequestError` (whose `err.code` field is
// enough on its own, and avoids a runtime dependency on the class import).

// P2025: an update/delete targeted a row that doesn't exist (already deleted
// — e.g. a concurrent duplicate "unvote"/"unlike" toggle beat this request).
export function isRecordNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';
}

// P2002: a create violated a unique constraint — e.g. two concurrent
// "create the reaction/vote row" requests raced and the loser sees this
// instead of the idempotent success the second identical tap should get.
export function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
