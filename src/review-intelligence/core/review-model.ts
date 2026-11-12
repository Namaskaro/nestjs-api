export type ReviewSourceRef = {
  reviewId: string;
  publicationId: string;
  sourceId: string;
};

export type ReviewAuthor = { id: string; name: string; image: string | null };

export type PublishedReview = {
  id: string;
  publicationId: string;
  productId: string;
  rating: number;
  text: string;
  publishedAt: Date;
  author: ReviewAuthor;
  addenda: readonly {
    id: string;
    publicationId: string;
    text: string;
    publishedAt: Date;
  }[];
};

export type ReviewSource = ReviewSourceRef & {
  productId: string;
  sourceKind: 'review' | 'addendum';
  text: string;
  rating: number;
  publishedAt: Date;
  author: ReviewAuthor;
};

export function reviewSources(
  rows: readonly PublishedReview[],
): ReviewSource[] {
  return rows.flatMap((row) => {
    const base = {
      productId: row.productId,
      reviewId: row.id,
      publicationId: row.publicationId,
      rating: row.rating,
      author: row.author,
    };
    return [
      {
        ...base,
        sourceId: row.publicationId,
        sourceKind: 'review' as const,
        text: row.text,
        publishedAt: row.publishedAt,
      },
      ...row.addenda.flatMap((entry) =>
        entry.publicationId === row.publicationId
          ? [
              {
                ...base,
                sourceId: entry.id,
                sourceKind: 'addendum' as const,
                text: entry.text,
                publishedAt: entry.publishedAt,
              },
            ]
          : [],
      ),
    ];
  });
}

export type RatingGroup = { productId: string; rating: number; count: number };
export type ReviewStats = {
  averageRating: number | null;
  ratingCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  positivePercent: number;
};

export function reviewStats(
  productIds: readonly string[],
  groups: readonly RatingGroup[],
) {
  const stats = new Map<string, ReviewStats>(
    productIds.map((id) => [
      id,
      {
        averageRating: null,
        ratingCount: 0,
        positiveCount: 0,
        neutralCount: 0,
        negativeCount: 0,
        positivePercent: 0,
      },
    ]),
  );
  const sums = new Map<string, number>();
  for (const { productId, rating, count } of groups) {
    const entry = stats.get(productId);
    if (!entry) continue;
    entry.ratingCount += count;
    sums.set(productId, (sums.get(productId) ?? 0) + rating * count);
    if (rating >= 4) entry.positiveCount += count;
    else if (rating === 3) entry.neutralCount += count;
    else entry.negativeCount += count;
  }
  for (const [id, entry] of stats) {
    if (!entry.ratingCount) continue;
    entry.averageRating = (sums.get(id) ?? 0) / entry.ratingCount;
    entry.positivePercent = (entry.positiveCount * 100) / entry.ratingCount;
  }
  return stats;
}

export type SummaryImpressions = {
  positiveImpressions: string[];
  negativeImpressions: string[];
  summary: string;
};

export type ReviewSummaryEvidence = SummaryImpressions & {
  productId: string;
  generatedAt: string;
  sourceReviewCount: number;
  sourceVersion: number;
  lastRetractionVersion: number;
};

export type ReviewExperience = ReviewStats & {
  summary: ReviewSummaryEvidence | null;
};

export function reviewEvidenceIsCurrent(
  used: ReviewExperience,
  current?: ReviewExperience,
) {
  return (
    !!current &&
    current.ratingCount === used.ratingCount &&
    current.averageRating === used.averageRating &&
    (!used.summary ||
      (!!current.summary &&
        current.summary.lastRetractionVersion <=
          used.summary.lastRetractionVersion))
  );
}
