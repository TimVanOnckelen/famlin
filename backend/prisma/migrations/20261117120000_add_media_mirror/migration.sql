-- CreateTable
CREATE TABLE "MediaMirrorTarget" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'immich',
    "externalAlbumId" TEXT NOT NULL,
    "albumName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mirrorSince" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "MediaMirrorTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaMirror" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAlbumId" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "externalAssetId" TEXT,
    "addedByFamlin" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaMirrorTarget_groupId_key" ON "MediaMirrorTarget"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaMirror_provider_externalAlbumId_assetKey_key" ON "MediaMirror"("provider", "externalAlbumId", "assetKey");

-- CreateIndex
CREATE INDEX "MediaMirror_provider_externalAssetId_idx" ON "MediaMirror"("provider", "externalAssetId");

-- AddForeignKey
ALTER TABLE "MediaMirrorTarget" ADD CONSTRAINT "MediaMirrorTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
