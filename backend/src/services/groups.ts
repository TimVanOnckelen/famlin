import { prisma } from '../db.js';

// Shared by every route that needs "is this user in this group" before
// returning/mutating group-scoped content (posts, comments, likes, ...).
export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!membership;
}

// All groups the user belongs to — the implicit filter for feed queries that
// span groups (GET /api/posts without an explicit groupIds selection).
export async function getUserGroupIds(userId: string): Promise<string[]> {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  return memberships.map((m) => m.groupId);
}
