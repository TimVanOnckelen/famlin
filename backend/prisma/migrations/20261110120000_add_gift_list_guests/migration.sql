CREATE TABLE "GiftListGuest" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftListGuest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GiftListGuest_postId_idx" ON "GiftListGuest"("postId");
CREATE INDEX "GiftListGuest_managedById_idx" ON "GiftListGuest"("managedById");

ALTER TABLE "GiftListGuest" ADD CONSTRAINT "GiftListGuest_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftListGuest" ADD CONSTRAINT "GiftListGuest_managedById_fkey"
    FOREIGN KEY ("managedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GiftListItem" ADD COLUMN "guestId" TEXT;
CREATE INDEX "GiftListItem_guestId_idx" ON "GiftListItem"("guestId");
ALTER TABLE "GiftListItem" ADD CONSTRAINT "GiftListItem_guestId_fkey"
    FOREIGN KEY ("guestId") REFERENCES "GiftListGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
