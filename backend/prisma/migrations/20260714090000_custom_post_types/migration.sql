ALTER TABLE "Post" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Post" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Post" ALTER COLUMN "type" SET DEFAULT 'UPDATE';
DROP TYPE "PostType";
ALTER TABLE "Post" ADD COLUMN "typeData" JSONB;
CREATE TABLE "PostInteraction" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostInteraction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PostInteraction_postId_userId_key_key" ON "PostInteraction"("postId", "userId", "key");
CREATE INDEX "PostInteraction_postId_key_idx" ON "PostInteraction"("postId", "key");
ALTER TABLE "PostInteraction" ADD CONSTRAINT "PostInteraction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostInteraction" ADD CONSTRAINT "PostInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
