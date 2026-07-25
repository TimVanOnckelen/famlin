-- Multiple photos/videos per comment. `attachmentUrl` stays as the legacy
-- single-attachment column (kept in sync with attachmentUrls[0] on every
-- write) so already-installed clients keep rendering the first photo.
ALTER TABLE "Comment" ADD COLUMN "attachmentUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Comment"
SET "attachmentUrls" = ARRAY["attachmentUrl"]
WHERE "attachmentUrl" IS NOT NULL;
