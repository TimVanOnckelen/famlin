-- CreateEnum
CREATE TYPE "NewAssetMode" AS ENUM ('OFF', 'MANUAL', 'AUTO');

-- AlterTable: src/jobs/newAssets.ts's per-link "surface new assets" setting
-- (OFF/MANUAL/AUTO) plus the watermark it advances on every run.
ALTER TABLE "MediaAlbumLink" ADD COLUMN     "newAssetMode" "NewAssetMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "newAssetsCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MediaPersonLink" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalPersonId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaPersonLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaPersonLink_provider_externalPersonId_key" ON "MediaPersonLink"("provider", "externalPersonId");

-- AddForeignKey
ALTER TABLE "MediaPersonLink" ADD CONSTRAINT "MediaPersonLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
