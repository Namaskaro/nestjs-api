/*
  Warnings:

  - You are about to drop the column `is-two-factor-enabled` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `is_guest` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `last_seen` on the `user` table. All the data in the column will be lost.
  - You are about to drop the `session` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "session" DROP CONSTRAINT "session_user_id_fkey";

-- DropIndex
DROP INDEX "idx_user_is_guest_last_seen";

-- AlterTable
ALTER TABLE "user" DROP COLUMN "is-two-factor-enabled",
DROP COLUMN "is_guest",
DROP COLUMN "last_seen",
ADD COLUMN     "is_two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "session";

-- CreateTable
CREATE TABLE "ProductEmbedding" (
    "productId" TEXT NOT NULL,
    "vector" vector(1536) NOT NULL,

    CONSTRAINT "ProductEmbedding_pkey" PRIMARY KEY ("productId")
);

-- AddForeignKey
ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
