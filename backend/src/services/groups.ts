import { prisma } from '../db.js';

// Shared by every route that needs "is this user in this group" before
// returning/mutating group-scoped content (posts, comments, likes, ...).
export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!membership;
}
