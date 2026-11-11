-- Personal access tokens no longer carry their owner's admin rights unless
-- created with them. New tokens default to no admin access.
ALTER TABLE "ApiToken" ADD COLUMN "adminAccess" BOOLEAN NOT NULL DEFAULT false;

-- Tokens that already exist keep working exactly as before: until now every
-- token of an admin had admin rights, and an integration relying on that
-- (a scripted export, for instance) must not break on upgrade.
UPDATE "ApiToken" SET "adminAccess" = true
WHERE "userId" IN (SELECT "id" FROM "User" WHERE "isAdmin" = true);
