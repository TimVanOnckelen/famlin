CREATE TABLE "WikiPage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "circleId" TEXT,
    "title" TEXT NOT NULL,
    "emoji" TEXT,
    "category" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WikiPage_groupId_updatedAt_idx" ON "WikiPage"("groupId", "updatedAt");
CREATE INDEX "WikiPage_circleId_idx" ON "WikiPage"("circleId");

ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_circleId_fkey"
    FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WikiPage" ADD CONSTRAINT "WikiPage_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
