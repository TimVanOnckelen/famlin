import { prisma } from '../db.js';

interface OnThisDayPost {
  id: string;
  groupId: string;
  createdAt: Date;
}

// Posts created on today's month/day in a previous year, scoped to one group
// — powers the member-facing "memories" banner (GET /api/posts/on-this-day).
// Note: like most "on this day" implementations, a Feb 29 post won't
// resurface in non-leap years — an accepted MVP simplification.
export async function getOnThisDayPosts(groupId: string, referenceDate = new Date()): Promise<OnThisDayPost[]> {
  const month = referenceDate.getMonth() + 1;
  const day = referenceDate.getDate();
  const year = referenceDate.getFullYear();

  return prisma.$queryRaw<OnThisDayPost[]>`
    SELECT id, "groupId", "createdAt" FROM "Post"
    WHERE "groupId" = ${groupId}
      AND "deletedAt" IS NULL
      AND EXTRACT(MONTH FROM "createdAt") = ${month}
      AND EXTRACT(DAY FROM "createdAt") = ${day}
      AND EXTRACT(YEAR FROM "createdAt") < ${year}
    ORDER BY "createdAt" DESC
  `;
}

interface OnThisDayPostWithNames extends OnThisDayPost {
  authorName: string;
  groupName: string;
}

// Same match across every group, joined with author/group name so the daily
// notification job can render its message without a query per post — used
// only by jobs/onThisDay.ts.
export async function getAllOnThisDayPosts(referenceDate = new Date()): Promise<OnThisDayPostWithNames[]> {
  const month = referenceDate.getMonth() + 1;
  const day = referenceDate.getDate();
  const year = referenceDate.getFullYear();

  return prisma.$queryRaw<OnThisDayPostWithNames[]>`
    SELECT p.id, p."groupId", p."createdAt", u.name as "authorName", g.name as "groupName"
    FROM "Post" p
    JOIN "User" u ON u.id = p."authorId"
    JOIN "Group" g ON g.id = p."groupId"
    WHERE p."deletedAt" IS NULL
      AND EXTRACT(MONTH FROM p."createdAt") = ${month}
      AND EXTRACT(DAY FROM p."createdAt") = ${day}
      AND EXTRACT(YEAR FROM p."createdAt") < ${year}
  `;
}
