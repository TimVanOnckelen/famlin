-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'LOVE', 'HAHA', 'WOW', 'SAD', 'CARE');

-- AlterTable
ALTER TABLE "Like" ADD COLUMN     "type" "ReactionType" NOT NULL DEFAULT 'LIKE';
