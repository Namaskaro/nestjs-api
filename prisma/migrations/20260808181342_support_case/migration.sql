/*
  Warnings:

  - You are about to drop the column `status` on the `Chat` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ChatMode" AS ENUM ('BOT', 'WAITING_OPERATOR', 'OPERATOR');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('WAITING_OPERATOR', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupportCaseReason" AS ENUM ('CUSTOMER_REQUEST', 'UNSUPPORTED_ACTION', 'ASSISTANT_FAILURE');

-- DropIndex
DROP INDEX "Chat_operatorId_status_idx";

-- DropIndex
DROP INDEX "Chat_status_lastMessageAt_idx";

-- DropIndex
DROP INDEX "Chat_userId_lastMessageAt_idx";

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "status",
ADD COLUMN     "mode" "ChatMode" NOT NULL DEFAULT 'BOT';

-- DropEnum
DROP TYPE "ChatStatus";

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "operatorId" TEXT,
    "reason" "SupportCaseReason" NOT NULL,
    "issue" TEXT NOT NULL,
    "summary" TEXT,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'WAITING_OPERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportCase_userId_status_idx" ON "SupportCase"("userId", "status");

-- CreateIndex
CREATE INDEX "SupportCase_operatorId_status_idx" ON "SupportCase"("operatorId", "status");

-- CreateIndex
CREATE INDEX "SupportCase_chatId_createdAt_idx" ON "SupportCase"("chatId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCase_status_createdAt_idx" ON "SupportCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Chat_operatorId_mode_idx" ON "Chat"("operatorId", "mode");

-- CreateIndex
CREATE INDEX "Chat_mode_lastMessageAt_idx" ON "Chat"("mode", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "OperatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
