ALTER TABLE "Upload"
ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'ready',
ADD COLUMN "sourceFilename" TEXT,
ADD COLUMN "uploadSessionId" TEXT,
ADD COLUMN "livePhotoIdentifier" TEXT,
ADD COLUMN "mediaKind" TEXT NOT NULL DEFAULT 'image',
ADD COLUMN "motionAssetKey" TEXT,
ADD COLUMN "mediaUrl" TEXT,
ADD COLUMN "thumbnailUrl" TEXT,
ADD COLUMN "processingStartedAt" TIMESTAMP(3),
ADD COLUMN "processingError" TEXT;
CREATE INDEX "Upload_processingStatus_idx" ON "Upload"("processingStatus");
CREATE UNIQUE INDEX "Upload_motionAssetKey_key" ON "Upload"("motionAssetKey");
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_motionAssetKey_fkey" FOREIGN KEY ("motionAssetKey") REFERENCES "Upload"("assetKey") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Upload_uploaderId_uploadSessionId_bound_idx" ON "Upload"("uploaderId", "uploadSessionId", "bound");
