/*
  Warnings:

  - You are about to drop the `QuickReply` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "product" ADD COLUMN     "color" TEXT;

-- DropTable
DROP TABLE "QuickReply";
