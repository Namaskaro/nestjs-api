-- CreateEnum
CREATE TYPE "ConsultationEpisodeStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConsultationEpisodeOutcome" AS ENUM ('PRODUCT_SELECTED', 'NO_MATCH', 'USER_CANCELLED', 'FINISHED_UNSPECIFIED');

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "consultationAttemptId" TEXT,
ADD COLUMN     "consultationInputSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "consultationSourceMessageId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "assistantSourceMessageId" TEXT,
ADD COLUMN     "clientMessageId" TEXT,
ADD COLUMN     "consultationInputSeq" INTEGER,
ADD COLUMN     "expectsEpisodeProjection" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConsultationMemoryScope" (
    "id" TEXT NOT NULL,
    "storeKey" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "chatId" TEXT,
    "memoryEpoch" INTEGER NOT NULL DEFAULT 0,
    "purgedThroughSeq" INTEGER NOT NULL DEFAULT 0,
    "offerSuppressedUntil" TIMESTAMP(3),

    CONSTRAINT "ConsultationMemoryScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationEpisode" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PRODUCT_SELECTION',
    "status" "ConsultationEpisodeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "ConsultationEpisodeOutcome",
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "lastMeaningfulAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ConsultationEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationResumeOffer" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "episodeRevision" INTEGER NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "memoryEpoch" INTEGER NOT NULL,
    "inputSeq" INTEGER NOT NULL,
    "handoffVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ConsultationResumeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationTurnReceipt" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "assistantMessageId" TEXT NOT NULL,
    "inputSeq" INTEGER NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "appliedRevisions" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationTurnReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consultation_memory_source_key" ON "ConsultationMemoryScope"("storeKey", "subjectKey", "sourceKind", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_memory_chat_key" ON "ConsultationMemoryScope"("storeKey", "chatId");

-- CreateIndex
CREATE INDEX "ConsultationEpisode_scopeId_status_lastMeaningfulAt_idx" ON "ConsultationEpisode"("scopeId", "status", "lastMeaningfulAt");

-- CreateIndex
CREATE INDEX "ConsultationEpisode_expiresAt_idx" ON "ConsultationEpisode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationEpisode_scopeId_taskKey_key" ON "ConsultationEpisode"("scopeId", "taskKey");

-- CreateIndex
CREATE INDEX "ConsultationResumeOffer_scopeId_expiresAt_idx" ON "ConsultationResumeOffer"("scopeId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationResumeOffer_episodeId_contentRevision_key" ON "ConsultationResumeOffer"("episodeId", "contentRevision");

-- CreateIndex
CREATE INDEX "ConsultationTurnReceipt_expiresAt_idx" ON "ConsultationTurnReceipt"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationTurnReceipt_scopeId_sourceMessageId_key" ON "ConsultationTurnReceipt"("scopeId", "sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_chatId_clientMessageId_key" ON "Message"("chatId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_chatId_assistantSourceMessageId_key" ON "Message"("chatId", "assistantSourceMessageId");

-- AddForeignKey
ALTER TABLE "ConsultationMemoryScope" ADD CONSTRAINT "ConsultationMemoryScope_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationEpisode" ADD CONSTRAINT "ConsultationEpisode_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ConsultationMemoryScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationResumeOffer" ADD CONSTRAINT "ConsultationResumeOffer_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ConsultationMemoryScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationResumeOffer" ADD CONSTRAINT "ConsultationResumeOffer_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "ConsultationEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationTurnReceipt" ADD CONSTRAINT "ConsultationTurnReceipt_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "ConsultationMemoryScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
