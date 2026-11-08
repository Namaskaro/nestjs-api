import type { Prisma } from '@prisma/generated';

export const publishedReviewWhere = {
  status: 'PUBLISHED',
  deletedAt: null,
  publishedAt: { not: null },
  verifiedAt: { not: null },
  userId: { not: null },
  productId: { not: null },
  rating: { gte: 1, lte: 5 },
} satisfies Prisma.ReviewWhereInput;

const publicReviewSelect = {
  id: true,
  publicationId: true,
  rating: true,
  text: true,
  publishedAt: true,
  user: { select: { id: true, name: true, image: true } },
  addenda: {
    where: { status: 'PUBLISHED', publishedAt: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      publicationId: true,
      text: true,
      createdAt: true,
      publishedAt: true,
    },
  },
} satisfies Prisma.ReviewSelect;

export const publicReviewsQuery = {
  where: publishedReviewWhere,
  select: publicReviewSelect,
  orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
} satisfies Prisma.ReviewFindManyArgs;

type PublicReviewRow = Prisma.ReviewGetPayload<{
  select: typeof publicReviewSelect;
}>;

export function toPublicReviews(rows: readonly PublicReviewRow[]) {
  return rows.flatMap((row) => {
    if (!row.user || !row.publishedAt) return [];
    return [
      {
        id: row.id,
        publicationId: row.publicationId,
        text: row.text,
        rating: row.rating,
        createdAt: row.publishedAt,
        publishedAt: row.publishedAt,
        user: { ...row.user, name: row.user.name ?? 'Покупатель' },
        verifiedPurchase: true,
        addenda: row.addenda.flatMap((entry) =>
          entry.publicationId === row.publicationId && entry.publishedAt
            ? [
                {
                  id: entry.id,
                  text: entry.text,
                  createdAt: entry.createdAt,
                  publishedAt: entry.publishedAt,
                },
              ]
            : [],
        ),
      },
    ];
  });
}

export function withPublicReviews<T extends { reviews: PublicReviewRow[] }>(
  row: T,
) {
  const { reviews, ...product } = row;
  return { ...product, reviews: toPublicReviews(reviews) };
}
