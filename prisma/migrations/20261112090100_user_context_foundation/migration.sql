
CREATE TABLE "UserContextScope" (
  "id" TEXT NOT NULL,
  "storeKey" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "UserContextScope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserContextScope_revision_check" CHECK ("revision" >= 0)
);
CREATE UNIQUE INDEX "UserContextScope_storeKey_subjectKey_key" ON "UserContextScope" ("storeKey", "subjectKey");

CREATE TABLE "UserContextFact" (
  "id" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "domainKey" TEXT NOT NULL,
  "preferenceKey" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "confirmation" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "commandId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceEpisodeId" TEXT NOT NULL,
  "sourceEpisodeRevision" INTEGER NOT NULL,
  "sourceAttributeId" TEXT NOT NULL,
  "sourceOperator" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserContextFact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserContextFact_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "UserContextScope"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserContextFact_confirmation_check" CHECK ("confirmation" = 'CONFIRMED'),
  CONSTRAINT "UserContextFact_sourceEpisodeRevision_check" CHECK ("sourceEpisodeRevision" > 0)
);
CREATE UNIQUE INDEX "UserContextFact_scopeId_domainKey_preferenceKey_key" ON "UserContextFact" ("scopeId", "domainKey", "preferenceKey");
CREATE INDEX "UserContextFact_scopeId_sourceKind_sourceKey_sourceEpisodeId_idx" ON "UserContextFact" ("scopeId", "sourceKind", "sourceKey", "sourceEpisodeId");
