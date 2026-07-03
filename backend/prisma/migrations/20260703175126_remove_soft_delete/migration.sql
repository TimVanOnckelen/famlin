/*
  Warnings:

  - You are about to drop the column `deletedAt` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `deletedById` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `deletedById` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `User` table. All the data in the column will be lost.

*/

-- Purge rows that were only hidden via soft-delete before dropping the
-- deletedAt/deletedById columns below — otherwise previously-hidden content
-- and deactivated users would suddenly reappear once nothing filters on
-- deletedAt anymore. Order matters: a deactivated user's own posts/comments
-- must go too (User -> Post/Comment cascade), then any remaining
-- soft-deleted posts (Post -> Comment/Like/Favorite/Notification cascade),
-- then any remaining soft-deleted comments (Comment -> replies/Like cascade).
DELETE FROM "User" WHERE "deletedAt" IS NOT NULL;
DELETE FROM "Post" WHERE "deletedAt" IS NOT NULL;
DELETE FROM "Comment" WHERE "deletedAt" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_deletedById_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_deletedById_fkey";

-- DropIndex
DROP INDEX "Comment_postId_deletedAt_idx";

-- DropIndex
DROP INDEX "Post_groupId_deletedAt_createdAt_idx";

-- AlterTable
ALTER TABLE "Comment" DROP COLUMN "deletedAt",
DROP COLUMN "deletedById";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "deletedAt",
DROP COLUMN "deletedById";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "deletedAt";

-- CreateIndex
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_groupId_createdAt_idx" ON "Post"("groupId", "createdAt");
