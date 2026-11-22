-- CreateTable
CREATE TABLE "CalendarFeedToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarFeedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeedToken_userId_key" ON "CalendarFeedToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeedToken_tokenHash_key" ON "CalendarFeedToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "CalendarFeedToken" ADD CONSTRAINT "CalendarFeedToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
