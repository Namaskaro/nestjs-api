-- CreateTable
CREATE TABLE "FaqKnowledge" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,

    CONSTRAINT "FaqKnowledge_pkey" PRIMARY KEY ("id")
);
