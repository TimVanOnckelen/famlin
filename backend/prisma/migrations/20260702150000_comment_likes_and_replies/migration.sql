-- AlterTable: comments can reply to another comment
ALTER TABLE "Comment" ADD COLUMN     "parentId" TEXT;

-- AlterTable: a like can now belong to a post OR a comment
ALTER TABLE "Like" ADD COLUMN     "commentId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "postId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Like_commentId_userId_key" ON "Like"("commentId", "userId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
