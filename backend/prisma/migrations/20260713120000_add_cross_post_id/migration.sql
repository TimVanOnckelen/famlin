-- AlterTable: cross-posting — a Post gains an optional crossPostId shared by
-- every sibling row created for the same "post to multiple groups" write
-- (see the fan-out in routes/posts.ts's POST /). Null for an ordinary
-- single-group post.
ALTER TABLE "Post" ADD COLUMN "crossPostId" TEXT;

-- CreateIndex
CREATE INDEX "Post_crossPostId_idx" ON "Post"("crossPostId");
