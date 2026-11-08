-- Только поверх проверенного schema baseline; рабочая БД этой задачей не мигрируется.
BEGIN;
LOCK TABLE "Review" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Review"
    WHERE "user_id" IS NOT NULL AND "product_id" IS NOT NULL
    GROUP BY "user_id", "product_id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Review user/product duplicates require an explicit data migration decision';
  END IF;
END $$;
-- CreateEnum
CREATE TYPE "ReviewModerationStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewVoteValue" AS ENUM ('UP', 'DOWN');

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "downVotes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "indexAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "indexLeaseToken" TEXT,
ADD COLUMN     "indexLeaseUntil" TIMESTAMP(3),
ADD COLUMN     "indexNextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "indexPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedBy" TEXT,
ADD COLUMN     "moderationReason" TEXT,
ADD COLUMN     "popularityScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publicationId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedCorpusVersion" INTEGER,
ADD COLUMN     "stateVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "ReviewModerationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "upVotes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedOrderId" TEXT;

-- Заполняем идентичность старых строк; они остаются PENDING до ручной проверки покупки.
UPDATE "Review" SET "publicationId" = gen_random_uuid()::text, "submittedAt" = "created_at";
ALTER TABLE "Review" ALTER COLUMN "publicationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "ReviewAddendum" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ReviewModerationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "moderatedAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "moderationReason" TEXT,
    "publishedCorpusVersion" INTEGER,

    CONSTRAINT "ReviewAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewVote" (
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "value" "ReviewVoteValue" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewVote_pkey" PRIMARY KEY ("reviewId","userId")
);

-- CreateTable
CREATE TABLE "ReviewSummary" (
    "productId" TEXT NOT NULL,
    "positiveImpressions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "negativeImpressions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "generatedAt" TIMESTAMP(3),
    "sourceReviewCount" INTEGER NOT NULL DEFAULT 0,
    "sourceAuthorCount" INTEGER NOT NULL DEFAULT 0,
    "corpusVersion" INTEGER NOT NULL DEFAULT 0,
    "requestedVersion" INTEGER NOT NULL DEFAULT 0,
    "sourceVersion" INTEGER NOT NULL DEFAULT 0,
    "lastRetractionVersion" INTEGER NOT NULL DEFAULT 0,
    "sourceHash" TEXT,
    "analyzerVersion" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,

    CONSTRAINT "ReviewSummary_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "ReviewAddendum_reviewId_publicationId_status_createdAt_id_idx" ON "ReviewAddendum"("reviewId", "publicationId", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ReviewAddendum_status_createdAt_id_idx" ON "ReviewAddendum"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ReviewSummary_nextAttemptAt_leaseUntil_idx" ON "ReviewSummary"("nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Review_publicationId_key" ON "Review"("publicationId");

-- CreateIndex
CREATE INDEX "Review_product_id_status_deletedAt_publishedAt_id_idx" ON "Review"("product_id", "status", "deletedAt", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "Review_product_id_status_deletedAt_rating_publishedAt_id_idx" ON "Review"("product_id", "status", "deletedAt", "rating", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "Review_product_id_status_deletedAt_popularityScore_publishe_idx" ON "Review"("product_id", "status", "deletedAt", "popularityScore", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "Review_status_submittedAt_id_idx" ON "Review"("status", "submittedAt", "id");

-- CreateIndex
CREATE INDEX "Review_indexPending_indexNextAttemptAt_idx" ON "Review"("indexPending", "indexNextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_user_id_product_id_key" ON "Review"("user_id", "product_id");

-- AddForeignKey
ALTER TABLE "ReviewAddendum" ADD CONSTRAINT "ReviewAddendum_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVote" ADD CONSTRAINT "ReviewVote_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVote" ADD CONSTRAINT "ReviewVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSummary" ADD CONSTRAINT "ReviewSummary_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Старые некорректные оценки допустимы только в непубличном состоянии.
ALTER TABLE "Review" ADD CONSTRAINT "Review_published_content_check" CHECK (
  "status" <> 'PUBLISHED' OR (
    "publishedAt" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "verifiedOrderId" IS NOT NULL
    AND "user_id" IS NOT NULL AND "product_id" IS NOT NULL
    AND "rating" BETWEEN 1 AND 5 AND char_length(btrim("text")) BETWEEN 1 AND 4000
  )
);
ALTER TABLE "ReviewAddendum" ADD CONSTRAINT "ReviewAddendum_published_content_check" CHECK (
  "status" <> 'PUBLISHED' OR (
    "publishedAt" IS NOT NULL AND char_length(btrim("text")) BETWEEN 1 AND 4000
  )
);
COMMIT;
