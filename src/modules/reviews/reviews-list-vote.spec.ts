import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { ReviewsService } from './reviews.service';
import {
  nextReviewCursor,
  reviewPageRequest,
  reviewPopularityScore,
} from './review-publication';

const productId = '10000000-0000-4000-8000-000000000001';
const reviewId = '10000000-0000-4000-8000-000000000002';
const publicationId = '10000000-0000-4000-8000-000000000003';
const publishedAt = new Date('2026-11-01T12:00:00.000Z');
const publicRow = {
  id: reviewId,
  publicationId,
  publishedAt,
  rating: 4,
  popularityScore: 0,
  upVotes: 0,
  downVotes: 0,
  text: 'Удобные.',
  user: { id: 'author', name: 'Покупатель', image: null },
  addenda: [],
};

describe('Review keyset and Wilson', () => {
  it('использует согласованный Wilson с целочисленной точностью', () => {
    expect(reviewPopularityScore(0, 0)).toBe(0);
    expect(reviewPopularityScore(1, 0)).toBe(206543);
    expect(reviewPopularityScore(10, 0)).toBe(722459);
    expect(reviewPopularityScore(50, 10)).toBeGreaterThan(719000);
    expect(reviewPopularityScore(50, 10)).toBeLessThan(720000);
    expect(reviewPopularityScore(0, 10)).toBe(0);
  });

  it.each(['date', 'rating', 'popular'] as const)(
    'курсор %s сохраняет tuple, cutoff и порядок tie-break',
    (sort) => {
      const asOf = new Date('2026-11-02T12:00:00.000Z');
      const cursor = nextReviewCursor(productId, sort, asOf, publicRow);
      const request = reviewPageRequest(productId, { sort, take: 20, cursor });
      expect(request.asOf).toEqual(asOf);
      expect(request.orderBy.slice(-2)).toEqual([
        { publishedAt: 'desc' },
        { id: 'desc' },
      ]);
      expect(request.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productId,
            status: 'PUBLISHED',
            deletedAt: null,
          }),
          { publishedAt: { lte: asOf } },
        ]),
      );
      expect(JSON.stringify(request.where)).toContain(reviewId);
      expect(JSON.stringify(request.where)).toContain('lt');
    },
  );

  it('не использует наличие якоря и отвергает чужой/повреждённый курсор', () => {
    const cursor = nextReviewCursor(productId, 'date', new Date(), publicRow);
    expect(() =>
      reviewPageRequest('10000000-0000-4000-8000-000000000004', {
        cursor,
        sort: 'date',
        take: 20,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      reviewPageRequest(productId, { cursor, sort: 'popular', take: 20 }),
    ).toThrow(BadRequestException);
    expect(() =>
      reviewPageRequest(productId, {
        cursor: 'broken',
        sort: 'date',
        take: 20,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      reviewPageRequest(productId, { sort: 'date', take: 51 }),
    ).toThrow(BadRequestException);
  });
});

describe('ReviewsService: stats, pages and votes', () => {
  let db: any;
  let service: ReviewsService;
  beforeEach(() => {
    db = {
      product: { findUnique: jest.fn().mockResolvedValue({ id: productId }) },
      review: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _avg: { rating: 3.25 }, _count: { _all: 4 } }),
        groupBy: jest
          .fn()
          .mockResolvedValue(
            [1, 3, 4, 5].map((rating) => ({ rating, _count: { _all: 1 } })),
          ),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockResolvedValue({
            ...publicRow,
            userId: 'author',
            productId,
            status: 'PUBLISHED',
            deletedAt: null,
            stateVersion: 7,
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      reviewVote: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    db.$transaction = jest.fn((action) =>
      Array.isArray(action) ? Promise.all(action) : action(db),
    );
    service = new ReviewsService(db as PrismaService);
  });

  it('агрегирует весь опубликованный корпус независимо от страницы', async () => {
    await expect(service.getProductStats(productId)).resolves.toEqual({
      averageRating: 3.25,
      ratingCount: 4,
      positiveCount: 2,
      neutralCount: 1,
      negativeCount: 1,
      positivePercent: 50,
    });
    expect(db.review.findMany).not.toHaveBeenCalled();
    expect(db.review.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PUBLISHED',
          deletedAt: null,
          productId,
        }),
      }),
    );
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('возвращает null среднего рейтинга при отсутствии оценок', async () => {
    db.review.aggregate.mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    });
    db.review.groupBy.mockResolvedValue([]);
    await expect(service.getProductStats(productId)).resolves.toEqual({
      averageRating: null,
      ratingCount: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      positivePercent: 0,
    });
  });

  it('по умолчанию выдаёт 20 и курсор, не загружает весь список', async () => {
    db.review.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        ...publicRow,
        id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      })),
    );
    const page = await service.getProductReviews(productId);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(db.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 21 }),
    );
    expect(
      JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString()).last.id,
    ).toBe(page.items[19].id);
  });

  it.each([
    [null, 'UP', 1, 0],
    ['UP', 'DOWN', 0, 1],
    ['DOWN', 'UP', 1, 0],
    ['UP', null, 0, 0],
  ] as const)(
    'меняет голос %s -> %s атомарно со счётчиками',
    async (previous, value, upVotes, downVotes) => {
      db.review.findFirst.mockResolvedValue({
        ...publicRow,
        userId: 'author',
        productId,
        stateVersion: 7,
        upVotes: Number(previous === 'UP'),
        downVotes: Number(previous === 'DOWN'),
      });
      db.reviewVote.findUnique.mockResolvedValue(
        previous
          ? { reviewId, userId: 'reader', publicationId, value: previous }
          : null,
      );
      await expect(
        service.setVote('reader', reviewId, { publicationId, value }),
      ).resolves.toEqual({
        reviewId,
        publicationId,
        upVotes,
        downVotes,
        myVote: value,
      });
      expect(db.review.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            publicationId,
            status: 'PUBLISHED',
            stateVersion: 7,
          }),
          data: expect.objectContaining({
            upVotes,
            downVotes,
            popularityScore: reviewPopularityScore(upVotes, downVotes),
          }),
        }),
      );
      if (value === null)
        expect(db.reviewVote.deleteMany).toHaveBeenCalledWith({
          where: { reviewId, userId: 'reader', publicationId },
        });
      else
        expect(db.reviewVote.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { reviewId_userId: { reviewId, userId: 'reader' } },
            update: { publicationId, value },
          }),
        );
      expect(db.review.aggregate).not.toHaveBeenCalled();
    },
  );

  it('повтор того же голоса и отмена отсутствующего голоса идемпотентны', async () => {
    await service.setVote('reader', reviewId, { publicationId, value: null });
    expect(db.review.updateMany).not.toHaveBeenCalled();
    db.reviewVote.findUnique.mockResolvedValue({ publicationId, value: 'UP' });
    await service.setVote('reader', reviewId, { publicationId, value: 'UP' });
    expect(db.reviewVote.upsert).not.toHaveBeenCalled();
  });

  it('запрещает self-vote, старую публикацию и непубличный отзыв', async () => {
    await expect(
      service.setVote('author', reviewId, { publicationId, value: 'UP' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setVote('reader', reviewId, {
        publicationId: 'old',
        value: 'UP',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    db.review.findFirst.mockResolvedValue(null);
    await expect(
      service.setVote('reader', reviewId, { publicationId, value: 'UP' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.reviewVote.upsert).not.toHaveBeenCalled();
  });

  it('конкурентное изменение родителя не записывает голос', async () => {
    db.review.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.setVote('reader', reviewId, { publicationId, value: 'UP' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.reviewVote.upsert).not.toHaveBeenCalled();
  });

  it('персональная выдача ограничена автором/товаром/IDs и текущей публикацией', async () => {
    db.reviewVote.findMany.mockResolvedValue([
      { reviewId, publicationId, value: 'UP', review: { publicationId } },
      {
        reviewId,
        publicationId: 'old',
        value: 'DOWN',
        review: { publicationId },
      },
    ]);
    await expect(
      service.getOwnVotes('reader', productId, [reviewId]),
    ).resolves.toEqual([{ reviewId, publicationId, value: 'UP' }]);
    expect(db.reviewVote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'reader',
          reviewId: { in: [reviewId] },
          review: {
            is: expect.objectContaining({
              productId,
              status: 'PUBLISHED',
              deletedAt: null,
            }),
          },
        }),
      }),
    );
  });
});
