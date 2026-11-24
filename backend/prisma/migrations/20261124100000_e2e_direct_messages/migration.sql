-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "encryptionDisabledAt" TIMESTAMP(3),
ADD COLUMN     "encryptionDisabledById" TEXT;

-- CreateTable
CREATE TABLE "E2eIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "signPublicKey" TEXT NOT NULL,
    "boxPublicKey" TEXT NOT NULL,
    "recoveryBackup" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "E2eIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "E2eIdentity_userId_idx" ON "E2eIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "E2eIdentity_userId_version_key" ON "E2eIdentity"("userId", "version");

-- AddForeignKey
ALTER TABLE "E2eIdentity" ADD CONSTRAINT "E2eIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
