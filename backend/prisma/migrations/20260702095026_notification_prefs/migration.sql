-- AlterTable: split the single emailNotificationsEnabled flag into per-event,
-- per-channel preferences, preserving each user's existing opt-in/out choice.
ALTER TABLE "User" ADD COLUMN "emailOnNewPost" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "emailOnNewComment" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "emailOnNewLike" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "pushOnNewPost" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "pushOnNewComment" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "pushOnNewLike" BOOLEAN NOT NULL DEFAULT true;

UPDATE "User" SET
  "emailOnNewPost" = "emailNotificationsEnabled",
  "emailOnNewComment" = "emailNotificationsEnabled",
  "emailOnNewLike" = "emailNotificationsEnabled";

ALTER TABLE "User" DROP COLUMN "emailNotificationsEnabled";
