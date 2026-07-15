-- CreateTable
CREATE TABLE "PushDeliveryLog" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "notifyType" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL,
    "failureCount" INTEGER NOT NULL,
    "triggeredByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushDeliveryLog_postId_createdAt_idx" ON "PushDeliveryLog"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "PushDeliveryLog_createdAt_idx" ON "PushDeliveryLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PushDeliveryLog" ADD CONSTRAINT "PushDeliveryLog_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDeliveryLog" ADD CONSTRAINT "PushDeliveryLog_triggeredByAdminId_fkey" FOREIGN KEY ("triggeredByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
