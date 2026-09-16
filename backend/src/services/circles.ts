import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

// A Circle is a smaller, reusable audience inside one Group. Group membership
// remains the outer authorization boundary — a Circle only ever NARROWS it,
// never widens it — so every query below is written to be composed with the
// existing group filter rather than to replace it.

export async function isCircleMember(circleId: string, userId: string): Promise<boolean> {
  const membership = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
  });
  return !!membership;
}

// Every circle the user belongs to, across all their groups — the implicit
// filter for feed queries, mirroring getUserGroupIds.
export async function getUserCircleIds(userId: string): Promise<string[]> {
  const memberships = await prisma.circleMember.findMany({
    where: { userId },
    select: { circleId: true },
  });
  return memberships.map((m) => m.circleId);
}

// THE post visibility predicate. Every member-facing query that reads posts
// MUST compose its own filter with this one rather than hand-writing the
// circle clause, because a query that forgets it fails OPEN — it returns
// circle-private posts to the whole group, silently and with no error.
//
// Semantics: a post is visible when it belongs to a group the caller is in
// AND it is either un-scoped (circleId null, the whole-family case that
// covers every post predating Circles) or scoped to a circle the caller
// belongs to.
//
// `groupIds` is the already-authorized set of groups for this request — the
// caller is responsible for having checked membership, exactly as before.
export function visiblePostsWhere(groupIds: string[], circleIds: string[]): Prisma.PostWhereInput {
  return {
    groupId: { in: groupIds },
    OR: [{ circleId: null }, { circleId: { in: circleIds } }],
  };
}

// Convenience wrapper for the common case: resolve the caller's circles and
// build the predicate in one step.
export async function visiblePostsWhereFor(groupIds: string[], userId: string): Promise<Prisma.PostWhereInput> {
  return visiblePostsWhere(groupIds, await getUserCircleIds(userId));
}

// Can this user read this specific post? Used by every single-post route
// (detail, comments, likes, favorites, interactions) after its existing
// requireGroupMember check. Group membership is assumed already verified;
// this adds only the circle narrowing.
export async function canViewPostCircle(circleId: string | null, userId: string): Promise<boolean> {
  if (!circleId) return true;
  return isCircleMember(circleId, userId);
}

// Validates a client-supplied circleId at post-creation time: the circle must
// exist, belong to the target group, and have the author as a member.
// Returns a machine-readable reason rather than a translated string so the
// route owns the i18n, matching how the post-type handlers report errors.
export type CircleTargetError = 'circleNotFound' | 'circleNotInGroup' | 'circleNotMember';

export async function validateCircleTarget(
  circleId: string,
  groupId: string,
  userId: string
): Promise<CircleTargetError | null> {
  const circle = await prisma.circle.findUnique({ where: { id: circleId }, select: { groupId: true } });
  // A non-member must not be able to tell a circle apart from a circle that
  // doesn't exist, so "wrong group" and "not a member" are reported
  // distinctly here but collapse to the same 403 in the route.
  if (!circle) return 'circleNotFound';
  if (circle.groupId !== groupId) return 'circleNotInGroup';
  if (!(await isCircleMember(circleId, userId))) return 'circleNotMember';
  return null;
}
