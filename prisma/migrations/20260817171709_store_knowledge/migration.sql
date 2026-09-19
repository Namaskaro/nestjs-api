/*
  Warnings:

  - You are about to drop the column `content` on the `StoreKnowledge` table. All the data in the column will be lost.
  - You are about to drop the column `footnotes` on the `StoreKnowledge` table. All the data in the column will be lost.
  - You are about to drop the column `isSourceQuestion` on the `StoreKnowledge` table. All the data in the column will be lost.
  - You are about to drop the column `notices` on the `StoreKnowledge` table. All the data in the column will be lost.
  - You are about to drop the column `region` on the `StoreKnowledge` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "StoreKnowledge_region_idx";

-- DropIndex
DROP INDEX "StoreKnowledge_topic_idx";

-- AlterTable
ALTER TABLE "StoreKnowledge" DROP COLUMN "content",
DROP COLUMN "footnotes",
DROP COLUMN "isSourceQuestion",
DROP COLUMN "notices",
DROP COLUMN "region",
ADD COLUMN     "footnote" TEXT,
ADD COLUMN     "notice" TEXT;
