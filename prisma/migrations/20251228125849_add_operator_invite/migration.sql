/*
  Warnings:

  - A unique constraint covering the columns `[inviteToken]` on the table `OperatorProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "TokenType" ADD VALUE 'INVITE';

-- AlterTable
ALTER TABLE "OperatorProfile" ADD COLUMN     "inviteExpires" TIMESTAMP(3),
ADD COLUMN     "inviteToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OperatorProfile_inviteToken_key" ON "OperatorProfile"("inviteToken");
