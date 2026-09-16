-- Family Circles: a smaller, reusable audience inside one Group.
--
-- Circles NARROW group membership, they never widen it. Every existing post
-- gets "circleId" NULL, which means "visible to the whole group" — exactly
-- the behaviour it had before this migration — so this is additive and
-- requires no backfill.

CREATE TABLE "Circle" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Circle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Circle_groupId_idx" ON "Circle"("groupId");

ALTER TABLE "Circle" ADD CONSTRAINT "Circle_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: deleting the admin who created a circle must never
-- delete the circle or the content inside it.
ALTER TABLE "Circle" ADD CONSTRAINT "Circle_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CircleMember" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CircleMember_circleId_userId_key" ON "CircleMember"("circleId", "userId");
CREATE INDEX "CircleMember_userId_idx" ON "CircleMember"("userId");

ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_circleId_fkey"
    FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CircleMember" ADD CONSTRAINT "CircleMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a Circle permanently deletes its posts (and, through the existing
-- cascades on Post, their comments/likes/favorites). There is deliberately no
-- "promote to whole family" fallback: silently widening an audience is the
-- exact failure this feature exists to prevent.
ALTER TABLE "Post" ADD COLUMN "circleId" TEXT;

CREATE INDEX "Post_circleId_idx" ON "Post"("circleId");

ALTER TABLE "Post" ADD CONSTRAINT "Post_circleId_fkey"
    FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reverse index from an uploaded file to the audience allowed to read it, so
-- /uploads/* can be authorized per request rather than relying on the URL
-- being unguessable. Keyed on the upload's UUID rather than a path, so one
-- row covers every rendition of the same upload (display copy, -thumbnail,
-- video poster, generated HEIC rendition).
--
-- Uploads predating this table have no row and stay readable exactly as
-- before — enforcement is forward-looking and there is no backfill.
--
-- "circleId" is intentionally NOT a foreign key: if it cascaded, deleting a
-- Circle would drop these rows and its media would silently become readable
-- family-wide. A dangling id keeps the asset unreadable, which is the correct
-- fail-closed direction for a privacy boundary.
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "uploaderId" TEXT,
    "circleId" TEXT,
    "bound" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Upload_assetKey_key" ON "Upload"("assetKey");
CREATE INDEX "Upload_circleId_idx" ON "Upload"("circleId");
CREATE INDEX "Upload_uploaderId_idx" ON "Upload"("uploaderId");

ALTER TABLE "Upload" ADD CONSTRAINT "Upload_uploaderId_fkey"
    FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
