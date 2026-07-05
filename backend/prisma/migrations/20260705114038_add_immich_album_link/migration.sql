-- CreateTable
CREATE TABLE "ImmichAlbumLink" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "immichAlbumId" TEXT NOT NULL,
    "albumName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImmichAlbumLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImmichAlbumLink_groupId_idx" ON "ImmichAlbumLink"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ImmichAlbumLink_groupId_immichAlbumId_key" ON "ImmichAlbumLink"("groupId", "immichAlbumId");

-- AddForeignKey
ALTER TABLE "ImmichAlbumLink" ADD CONSTRAINT "ImmichAlbumLink_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
