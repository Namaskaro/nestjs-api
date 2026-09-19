/*
  Warnings:

  - You are about to drop the `FaqKnowledge` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "FaqKnowledge";

-- CreateTable
CREATE TABLE "StoreKnowledge" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "topic" TEXT,
    "region" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "notices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "footnotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" TEXT NOT NULL,
    "isSourceQuestion" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreKnowledge_key_key" ON "StoreKnowledge"("key");

-- CreateIndex
CREATE INDEX "StoreKnowledge_section_isActive_idx" ON "StoreKnowledge"("section", "isActive");

-- CreateIndex
CREATE INDEX "StoreKnowledge_topic_idx" ON "StoreKnowledge"("topic");

-- CreateIndex
CREATE INDEX "StoreKnowledge_region_idx" ON "StoreKnowledge"("region");
