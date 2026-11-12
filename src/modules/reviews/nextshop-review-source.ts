import { Prisma } from '@prisma/generated';
import type { PrismaService } from '@/src/core/prisma/prisma.service';
import type {
  ReviewExperiencePort,
  ReviewProductLookup,
  ReviewSourcePort,
} from '@/src/review-intelligence/application/ports';
import type { PublishedReview } from '@/src/review-intelligence/core/review-model';
import { publicReviewsQuery, publishedReviewWhere } from './review-publication';

// The legacy NextShop database belongs to one trusted store.
export const NEXTSHOP_REVIEW_STORE = 'nextshop';

type ReviewReader = Pick<Prisma.TransactionClient, 'review'>;

export async function readPublishedReviews(
  db: ReviewReader,
  filter: {
    reviewIds?: readonly string[];
    productId?: string;
    oldestFirst?: boolean;
  },
): Promise<PublishedReview[]> {
  if (filter.reviewIds?.length === 0) return [];
  const rows = await db.review.findMany({
    ...publicReviewsQuery,
    where: {
      ...publishedReviewWhere,
      ...(filter.reviewIds ? { id: { in: [...filter.reviewIds] } } : {}),
      ...(filter.productId ? { productId: filter.productId } : {}),
    },
    ...(filter.oldestFirst
      ? { orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] }
      : {}),
    select: { ...publicReviewsQuery.select, productId: true },
  });
  return rows.flatMap((row) => {
    if (!row.user || !row.publishedAt || !row.productId) return [];
    return [
      {
        id: row.id,
        productId: row.productId,
        publicationId: row.publicationId,
        rating: row.rating,
        text: row.text,
        publishedAt: row.publishedAt,
        author: { ...row.user, name: row.user.name ?? 'Покупатель' },
        addenda: row.addenda.flatMap((entry) =>
          entry.publishedAt
            ? [
                {
                  id: entry.id,
                  publicationId: entry.publicationId,
                  text: entry.text,
                  publishedAt: entry.publishedAt,
                },
              ]
            : [],
        ),
      },
    ];
  });
}

export class NextShopReviewSource
  implements ReviewSourcePort, ReviewProductLookup, ReviewExperiencePort
{
  readonly storeId = NEXTSHOP_REVIEW_STORE;

  constructor(private readonly prisma: PrismaService) {}

  async productExists(id: string) {
    return !!(await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    }));
  }

  async hasPublished(productId: string) {
    return !!(await this.prisma.review.count({
      where: { ...publishedReviewWhere, productId },
    }));
  }

  listPublished(reviewIds: readonly string[], productId?: string) {
    return readPublishedReviews(this.prisma, { reviewIds, productId });
  }

  async ratingGroups(
    productIds: readonly string[],
    db: ReviewReader = this.prisma,
  ) {
    if (!productIds.length) return [];
    const groups = await db.review.groupBy({
      by: ['productId', 'rating'],
      where: {
        ...publishedReviewWhere,
        productId: { in: [...new Set(productIds)] },
      },
      _count: { _all: true },
    });
    return groups.flatMap((row) =>
      row.productId === null
        ? []
        : [
            {
              productId: row.productId,
              rating: row.rating,
              count: row._count._all,
            },
          ],
    );
  }

  experienceSnapshot(productIds: readonly string[]) {
    return this.prisma.$transaction(
      async (tx) => {
        const groups = await this.ratingGroups(productIds, tx);
        const rows = await tx.reviewSummary.findMany({
          where: {
            productId: { in: [...productIds] },
            summary: { not: null },
            generatedAt: { not: null },
            sourceReviewCount: { gte: 10 },
            sourceAuthorCount: { gte: 10 },
          },
          select: {
            productId: true,
            positiveImpressions: true,
            negativeImpressions: true,
            summary: true,
            generatedAt: true,
            sourceReviewCount: true,
            sourceVersion: true,
            lastRetractionVersion: true,
          },
        });
        return {
          groups,
          summaries: rows.flatMap((row) =>
            row.summary !== null && row.generatedAt
              ? [
                  {
                    ...row,
                    summary: row.summary,
                    generatedAt: row.generatedAt.toISOString(),
                  },
                ]
              : [],
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
