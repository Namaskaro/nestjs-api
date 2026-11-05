/*
  Warnings:

  - A unique constraint covering the columns `[requestId]` on the table `SupportCase` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SupportCaseKind" AS ENUM ('GENERAL', 'HANDOFF');

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "handoffVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OperatorProfile" ADD COLUMN     "availableUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupportCase" ADD COLUMN     "context" JSONB,
ADD COLUMN     "kind" "SupportCaseKind" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "sourceMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SupportCase_requestId_key" ON "SupportCase"("requestId");

-- CreateIndex
CREATE INDEX "SupportCase_chatId_kind_status_idx" ON "SupportCase"("chatId", "kind", "status");

-- CreateIndex
CREATE INDEX "SupportCase_kind_status_createdAt_idx" ON "SupportCase"("kind", "status", "createdAt");
