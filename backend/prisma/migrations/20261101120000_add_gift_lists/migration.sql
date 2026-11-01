-- AlterTable
ALTER TABLE "Circle" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CIRCLE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pushOnGiftList" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "GiftListItem" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "url" TEXT,
    "photoUrl" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftDrawAssignment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftDrawAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GiftListItem_postId_ownerId_position_idx" ON "GiftListItem"("postId", "ownerId", "position");

-- CreateIndex
CREATE INDEX "GiftListItem_ownerId_idx" ON "GiftListItem"("ownerId");

-- CreateIndex
CREATE INDEX "GiftDrawAssignment_giverId_idx" ON "GiftDrawAssignment"("giverId");

-- CreateIndex
CREATE INDEX "GiftDrawAssignment_recipientId_idx" ON "GiftDrawAssignment"("recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftDrawAssignment_postId_giverId_key" ON "GiftDrawAssignment"("postId", "giverId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftDrawAssignment_postId_recipientId_key" ON "GiftDrawAssignment"("postId", "recipientId");

-- AddForeignKey
ALTER TABLE "GiftListItem" ADD CONSTRAINT "GiftListItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftListItem" ADD CONSTRAINT "GiftListItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDrawAssignment" ADD CONSTRAINT "GiftDrawAssignment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDrawAssignment" ADD CONSTRAINT "GiftDrawAssignment_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDrawAssignment" ADD CONSTRAINT "GiftDrawAssignment_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
