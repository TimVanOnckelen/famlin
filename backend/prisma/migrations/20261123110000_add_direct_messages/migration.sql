-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "groupId" TEXT,
    "participantKey" TEXT,
    "title" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChatConversation_audience_check" CHECK (
        ("kind" = 'FAMILY' AND "groupId" IS NOT NULL)
        OR ("kind" = 'PRIVATE' AND "groupId" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "ChatConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- Preserve existing family chat IDs and rows while introducing their owner.
INSERT INTO "ChatConversation" ("id", "kind", "groupId", "createdAt", "updatedAt")
SELECT
    'family_' || "Group"."id",
    'FAMILY',
    "Group"."id",
    "Group"."createdAt",
    COALESCE(MAX("ChatMessage"."createdAt"), "Group"."createdAt")
FROM "Group"
LEFT JOIN "ChatMessage" ON "ChatMessage"."groupId" = "Group"."id"
GROUP BY "Group"."id", "Group"."createdAt";

-- Generalize the existing family message/read tables.
ALTER TABLE "ChatMessage"
    ADD COLUMN "conversationId" TEXT,
    ADD COLUMN "encryption" TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN "encryptedPayload" JSONB;
ALTER TABLE "ChatRead" ADD COLUMN "conversationId" TEXT;

UPDATE "ChatMessage"
SET "conversationId" = 'family_' || "groupId"
WHERE "groupId" IS NOT NULL;
UPDATE "ChatRead"
SET "conversationId" = 'family_' || "groupId"
WHERE "groupId" IS NOT NULL;

ALTER TABLE "ChatMessage" ALTER COLUMN "conversationId" SET NOT NULL;
ALTER TABLE "ChatMessage" ALTER COLUMN "groupId" DROP NOT NULL;
ALTER TABLE "ChatRead" ALTER COLUMN "conversationId" SET NOT NULL;
ALTER TABLE "ChatRead" ALTER COLUMN "groupId" DROP NOT NULL;

-- New settings and access scopes.
ALTER TABLE "User" ADD COLUMN "pushOnDirectMessage" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Notification" ADD COLUMN "relatedChatConversationId" TEXT;
ALTER TABLE "Upload"
    ADD COLUMN "chatConversationId" TEXT,
    ADD COLUMN "participantUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Replace the family-scoped read uniqueness with conversation scoping.
DROP INDEX "ChatRead_groupId_userId_key";
CREATE UNIQUE INDEX "ChatRead_conversationId_userId_key" ON "ChatRead"("conversationId", "userId");
CREATE INDEX "ChatRead_groupId_userId_idx" ON "ChatRead"("groupId", "userId");

-- Existing group history index is retained; add conversation and author lookups.
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");
CREATE INDEX "ChatMessage_authorId_idx" ON "ChatMessage"("authorId");
CREATE INDEX "ChatConversation_kind_updatedAt_idx" ON "ChatConversation"("kind", "updatedAt");
CREATE UNIQUE INDEX "ChatConversation_groupId_key" ON "ChatConversation"("groupId");
CREATE UNIQUE INDEX "ChatConversation_participantKey_key" ON "ChatConversation"("participantKey");
CREATE UNIQUE INDEX "ChatConversationParticipant_conversationId_userId_key"
    ON "ChatConversationParticipant"("conversationId", "userId");
CREATE INDEX "ChatConversationParticipant_userId_idx" ON "ChatConversationParticipant"("userId");
CREATE INDEX "Upload_chatConversationId_idx" ON "Upload"("chatConversationId");

-- AddForeignKey
ALTER TABLE "ChatConversation"
    ADD CONSTRAINT "ChatConversation_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatConversation"
    ADD CONSTRAINT "ChatConversation_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatConversationParticipant"
    ADD CONSTRAINT "ChatConversationParticipant_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatConversationParticipant"
    ADD CONSTRAINT "ChatConversationParticipant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage"
    ADD CONSTRAINT "ChatMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatRead"
    ADD CONSTRAINT "ChatRead_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_relatedChatConversationId_fkey"
    FOREIGN KEY ("relatedChatConversationId") REFERENCES "ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Upload"
    ADD CONSTRAINT "Upload_chatConversationId_fkey"
    FOREIGN KEY ("chatConversationId") REFERENCES "ChatConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
