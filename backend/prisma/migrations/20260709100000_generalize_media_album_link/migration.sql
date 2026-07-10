-- Generalize ImmichAlbumLink into MediaAlbumLink: the same rows, plus a
-- `provider` discriminator so non-Immich media sources (local folders, ...)
-- can link albums to groups through the same table. Existing rows are all
-- Immich links, which is exactly what the provider default backfills.
ALTER TABLE "ImmichAlbumLink" RENAME TO "MediaAlbumLink";
ALTER TABLE "MediaAlbumLink" RENAME COLUMN "immichAlbumId" TO "externalAlbumId";
ALTER TABLE "MediaAlbumLink" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'immich';

-- Rename the constraints/indexes to the names Prisma would generate for a
-- fresh create of this model, so a future `migrate diff` doesn't see drift.
ALTER TABLE "MediaAlbumLink" RENAME CONSTRAINT "ImmichAlbumLink_pkey" TO "MediaAlbumLink_pkey";
ALTER TABLE "MediaAlbumLink" RENAME CONSTRAINT "ImmichAlbumLink_groupId_fkey" TO "MediaAlbumLink_groupId_fkey";
ALTER INDEX "ImmichAlbumLink_groupId_idx" RENAME TO "MediaAlbumLink_groupId_idx";

-- The uniqueness rule now includes the provider.
DROP INDEX "ImmichAlbumLink_groupId_immichAlbumId_key";
CREATE UNIQUE INDEX "MediaAlbumLink_groupId_provider_externalAlbumId_key" ON "MediaAlbumLink"("groupId", "provider", "externalAlbumId");
