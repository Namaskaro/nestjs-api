import type { Prisma } from '@prisma/generated';
import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { ReviewListQueryDto, ReviewSort } from './dto/review-list.dto';

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
  upVotes: true,
  downVotes: true,
  popularityScore: true,
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
        upVotes: row.upVotes,
        downVotes: row.downVotes,
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

// Целочисленный Wilson lower bound, z=1.96, точность порядка 1e-6.
export function reviewPopularityScore(
  upVotes: number,
  downVotes: number,
): number {
  const n = upVotes + downVotes;
  if (!n) return 0;
  const p = upVotes / n;
  const z2 = 1.96 ** 2;
  const lower =
    (p +
      z2 / (2 * n) -
      1.96 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) /
    (1 + z2 / n);
  return Math.floor(Math.max(0, lower) * 1_000_000);
}

type ReviewCursor = {
  v: 1;
  productId: string;
  sort: ReviewSort;
  asOf: string;
  last: {
    id: string;
    publicationId: string;
    publishedAt: string;
    rating: number;
    score: number;
  };
};

function invalidCursor(): never {
  throw new BadRequestException({
    code: 'INVALID_REVIEW_CURSOR',
    message: 'Некорректный курсор отзывов. Обновите список.',
  });
}

function canonicalDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function reviewPageRequest(
  productId: string,
  query: ReviewListQueryDto,
) {
  const sort = query.sort ?? 'date';
  const take = query.take ?? 20;
  if (
    !['date', 'rating', 'popular'].includes(sort) ||
    !Number.isInteger(take) ||
    take < 1 ||
    take > 50
  ) {
    throw new BadRequestException({ code: 'INVALID_REVIEW_PAGE' });
  }
  let asOf = new Date();
  let after: Prisma.ReviewWhereInput = {};
  if (query.cursor !== undefined) {
    let cursor: ReviewCursor;
    try {
      if (
        typeof query.cursor !== 'string' ||
        query.cursor.length > 1024 ||
        !/^[A-Za-z0-9_-]+$/.test(query.cursor)
      )
        invalidCursor();
      cursor = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      );
    } catch {
      invalidCursor();
    }
    if (
      !cursor ||
      cursor.v !== 1 ||
      cursor.productId !== productId ||
      cursor.sort !== sort ||
      !canonicalDate(cursor.asOf) ||
      !cursor.last
    )
      invalidCursor();
    const last = cursor.last;
    if (
      !isUUID(last.id) ||
      !isUUID(last.publicationId) ||
      !canonicalDate(last.publishedAt) ||
      last.publishedAt > cursor.asOf ||
      !Number.isInteger(last.rating) ||
      last.rating < 1 ||
      last.rating > 5 ||
      !Number.isInteger(last.score) ||
      last.score < 0 ||
      last.score > 1_000_000
    )
      invalidCursor();
    asOf = new Date(cursor.asOf);
    const date = new Date(last.publishedAt);
    const tail: Prisma.ReviewWhereInput[] = [
      { publishedAt: { lt: date } },
      { publishedAt: date, id: { lt: last.id } },
    ];
    after =
      sort === 'date'
        ? { OR: tail }
        : sort === 'rating'
        ? {
            OR: [
              { rating: { lt: last.rating } },
              ...tail.map((where) => ({
                AND: [{ rating: last.rating }, where],
              })),
            ],
          }
        : {
            OR: [
              { popularityScore: { lt: last.score } },
              ...tail.map((where) => ({
                AND: [{ popularityScore: last.score }, where],
              })),
            ],
          };
  }
  const orderBy: Prisma.ReviewOrderByWithRelationInput[] = [
    ...(sort === 'rating'
      ? [{ rating: 'desc' as const }]
      : sort === 'popular'
      ? [{ popularityScore: 'desc' as const }]
      : []),
    { publishedAt: 'desc' },
    { id: 'desc' },
  ];
  const where: Prisma.ReviewWhereInput = {
    AND: [
      { ...publishedReviewWhere, productId },
      { publishedAt: { lte: asOf } },
      after,
    ],
  };
  return { sort, take, asOf, where, orderBy };
}

export function nextReviewCursor(
  productId: string,
  sort: ReviewSort,
  asOf: Date,
  row: PublicReviewRow,
): string {
  const cursor: ReviewCursor = {
    v: 1,
    productId,
    sort,
    asOf: asOf.toISOString(),
    last: {
      id: row.id,
      publicationId: row.publicationId,
      publishedAt: row.publishedAt.toISOString(),
      rating: row.rating,
      score: row.popularityScore,
    },
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
