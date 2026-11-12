import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { ReviewsService } from './reviews.service';
import { publicReviewsQuery, toPublicReviews } from './review-publication';

// Проверки правил сервиса; эти моки не проверяют ограничения и изоляцию PostgreSQL.
const productId = '00000000-0000-4000-8000-000000000001';
const publicationId = '00000000-0000-4000-8000-000000000002';
const input = { productId, text: '  Удобно носить.  ', rating: 4 };
const now = new Date('2026-11-08T00:00:00Z');
const state = {
  id: 'review',
  userId: 'owner',
  productId,
  publicationId,
  text: 'Удобно носить.',
  rating: 4,
  status: 'PENDING',
  deletedAt: null,
  stateVersion: 0,
};
const owner = { ...state, addenda: [], submittedAt: now, publishedAt: null };
const purchase = {
  id: 'order',
  items: [
    {
      productId,
      title: 'Товар',
      image: null,
      quantity: 1,
      size: null,
      price: '1000',
    },
  ],
};

describe('ReviewsService: публикация и принадлежность', () => {
  let db: any;
  let service: ReviewsService;

  beforeEach(() => {
    db = {
      product: { findUnique: jest.fn().mockResolvedValue({ id: productId }) },
      order: { findMany: jest.fn().mockResolvedValue([purchase]) },
      review: {
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(state),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(owner),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      reviewAddendum: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'addendum', status: 'PENDING' }),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      reviewVote: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      reviewSummary: {
        upsert: jest.fn().mockResolvedValue({
          productId,
          corpusVersion: 1,
          sourceReviewCount: 0,
          summary: null,
          nextAttemptAt: null,
          sourceVersion: 0,
        }),
        update: jest.fn(),
      },
    };
    db.$transaction = jest.fn((action) => action(db));
    service = new ReviewsService(db as PrismaService);
  });

  it('создаёт только PENDING от имени переданного JWT-автора и проверяет его DELIVERED-покупку', async () => {
    await expect(service.createReview('owner', input)).resolves.toMatchObject({
      status: 'PENDING',
    });
    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner',
          status: 'DELIVERED',
          items: { array_contains: [{ productId }] },
        },
      }),
    );
    expect(db.review.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'owner',
          productId,
          text: 'Удобно носить.',
          rating: 4,
          status: 'PENDING',
          publishedAt: null,
          verifiedOrderId: 'order',
        }),
      }),
    );
  });

  it('не разрешает отзыв без доставленной покупки', async () => {
    db.order.findMany.mockResolvedValue([]);
    await expect(service.createReview('other', input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.review.create).not.toHaveBeenCalled();
    await expect(
      service.getMineAndEligibility('other', productId),
    ).resolves.toMatchObject({
      canCreate: false,
      reason: 'NO_DELIVERED_PURCHASE',
    });
  });

  it('не принимает некорректный JSON или другой товар как подтверждение покупки', async () => {
    db.order.findMany.mockResolvedValue([
      { id: 'bad', items: [{ productId }] },
      { ...purchase, items: [{ ...purchase.items[0], productId: 'other' }] },
    ]);
    await expect(service.createReview('owner', input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([0, 6, 1.5, undefined, null])(
    'отклоняет недопустимую оценку %s',
    async (rating) => {
      await expect(
        service.createReview('owner', { ...input, rating: rating as number }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.review.create).not.toHaveBeenCalled();
    },
  );

  it.each([' ', '\0', 'x'.repeat(4001)])(
    'отклоняет пустой, недопустимый или слишком длинный текст',
    async (text) => {
      await expect(
        service.createReview('owner', { ...input, text }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('отклоняет второй действующий отзыв, в том числе после REJECTED', async () => {
    db.review.findUnique.mockResolvedValue({ ...state, status: 'REJECTED' });
    await expect(service.createReview('owner', input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.review.create).not.toHaveBeenCalled();
  });

  it('возвращает конфликт при срабатывании уникальности БД', async () => {
    db.review.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.createReview('owner', input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('одобрение повторно проверяет доставку и открывает публикацию; повторное решение идемпотентно', async () => {
    db.review.findUnique.mockResolvedValueOnce(state).mockResolvedValueOnce({
      ...owner,
      status: 'PUBLISHED',
      publishedAt: now,
    });
    await expect(
      service.moderateReview('manager', 'review', {
        publicationId,
        decision: 'PUBLISHED',
      }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(db.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PUBLISHED',
          moderatedBy: 'manager',
          publishedAt: expect.any(Date),
          verifiedOrderId: 'order',
        }),
      }),
    );
    db.review.updateMany.mockClear();
    db.review.findUnique.mockResolvedValue({
      ...owner,
      status: 'PUBLISHED',
      publishedAt: now,
    });
    await service.moderateReview('manager', 'review', {
      publicationId,
      decision: 'PUBLISHED',
    });
    expect(db.review.updateMany).not.toHaveBeenCalled();
    await expect(
      service.moderateReview('manager', 'review', {
        publicationId,
        decision: 'REJECTED',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('не публикует старый неподтверждённый отзыв', async () => {
    db.review.findUnique.mockResolvedValue(state);
    db.order.findMany.mockResolvedValue([]);
    await expect(
      service.moderateReview('admin', 'review', {
        publicationId,
        decision: 'PUBLISHED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.review.updateMany).not.toHaveBeenCalled();
  });

  it('отклоняет отзыв, сохраняя причину и непубличное состояние', async () => {
    db.review.findUnique
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce({ ...owner, status: 'REJECTED' });
    await expect(
      service.moderateReview('admin', 'review', {
        publicationId,
        decision: 'REJECTED',
        reason: ' Спам ',
      }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    expect(db.order.findMany).not.toHaveBeenCalled();
    expect(db.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          publishedAt: null,
          moderationReason: 'Спам',
        }),
      }),
    );
  });

  it('разрешает несколько PENDING-дополнений только к опубликованному отзыву', async () => {
    await expect(
      service.addAddendum('owner', 'review', {
        publicationId,
        text: 'После стирки.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    db.review.findFirst.mockResolvedValue({ ...state, status: 'PUBLISHED' });
    await service.addAddendum('owner', 'review', {
      publicationId,
      text: 'После стирки.',
    });
    await service.addAddendum('owner', 'review', {
      publicationId,
      text: 'Через месяц.',
    });
    expect(db.reviewAddendum.create).toHaveBeenCalledTimes(2);
    expect(db.reviewAddendum.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { reviewId: 'review', publicationId, text: 'Через месяц.' },
      }),
    );
  });

  it.each(['PUBLISHED', 'REJECTED'] as const)(
    'модерирует дополнение независимо: %s',
    async (decision) => {
      const entry = {
        id: 'addendum',
        reviewId: 'review',
        publicationId,
        status: 'PENDING',
        text: 'Через месяц.',
      };
      db.reviewAddendum.findUnique
        .mockResolvedValueOnce(entry)
        .mockResolvedValueOnce({ ...entry, status: decision });
      db.review.findUnique.mockResolvedValue({ ...state, status: 'PUBLISHED' });
      await expect(
        service.moderateAddendum('admin', 'addendum', {
          publicationId,
          decision,
        }),
      ).resolves.toMatchObject({ status: decision });
      expect(db.review.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { stateVersion: { increment: 1 } } }),
      );
      expect(db.reviewAddendum.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: decision,
            moderatedBy: 'admin',
            publishedAt: decision === 'PUBLISHED' ? expect.any(Date) : null,
          }),
        }),
      );
    },
  );

  it('не модерирует дополнение предыдущей публикации', async () => {
    db.reviewAddendum.findUnique.mockResolvedValue({
      id: 'addendum',
      reviewId: 'review',
      publicationId: 'old',
      status: 'PENDING',
    });
    db.review.findUnique.mockResolvedValue({ ...state, status: 'PUBLISHED' });
    await expect(
      service.moderateAddendum('admin', 'addendum', {
        publicationId,
        decision: 'PUBLISHED',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.reviewAddendum.updateMany).not.toHaveBeenCalled();
  });

  it('скрывает чужой отзыв от операций удаления и дополнения', async () => {
    db.review.findFirst.mockResolvedValue(null);
    await expect(
      service.deleteReview('other', 'review', publicationId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.addAddendum('other', 'review', { publicationId, text: 'Чужое.' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.review.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'review', userId: 'other' } }),
    );
    expect(db.review.updateMany).not.toHaveBeenCalled();
  });

  it('удаляет отзыв владельца, очищает голоса и допускает повтор удаления', async () => {
    await service.deleteReview('owner', 'review', publicationId);
    expect(db.review.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          upVotes: 0,
          downVotes: 0,
        }),
      }),
    );
    expect(db.reviewVote.deleteMany).toHaveBeenCalledWith({
      where: { reviewId: 'review' },
    });
    db.review.updateMany.mockClear();
    db.review.findFirst.mockResolvedValue({ ...state, deletedAt: now });
    await service.deleteReview('owner', 'review', publicationId);
    expect(db.review.updateMany).not.toHaveBeenCalled();
  });

  it('новая публикация очищает прежние дополнения и голоса и снова требует модерации', async () => {
    db.review.findUnique
      .mockResolvedValueOnce({ ...state, deletedAt: now })
      .mockResolvedValueOnce(owner);
    await service.createReview('owner', input);
    const data = db.review.updateMany.mock.calls[0][0].data;
    expect(data.publicationId).not.toBe(publicationId);
    expect(data).toMatchObject({
      status: 'PENDING',
      publishedAt: null,
      deletedAt: null,
      upVotes: 0,
      downVotes: 0,
      indexPending: true,
      indexNextAttemptAt: expect.any(Date),
      indexLeaseToken: null,
      publishedCorpusVersion: null,
    });
    expect(db.reviewAddendum.deleteMany).toHaveBeenCalledWith({
      where: { reviewId: 'review' },
    });
    expect(db.reviewVote.deleteMany).toHaveBeenCalledWith({
      where: { reviewId: 'review' },
    });
  });

  it('запоздалые удаление и модерация не затрагивают новую публикацию', async () => {
    db.review.findUnique.mockResolvedValue(state);
    await expect(
      service.deleteReview('owner', 'review', 'old'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.moderateReview('admin', 'review', {
        publicationId: 'old',
        decision: 'PUBLISHED',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.review.updateMany).not.toHaveBeenCalled();
  });

  it('возвращает конфликт при изменении родительской строки конкурентным запросом', async () => {
    db.review.findFirst.mockResolvedValue({ ...state, status: 'PUBLISHED' });
    db.review.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.addAddendum('owner', 'review', {
        publicationId,
        text: 'Дополнение.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.reviewAddendum.create).not.toHaveBeenCalled();
    db.$transaction.mockRejectedValue({ code: 'P2034' });
    await expect(
      service.deleteReview('owner', 'review', publicationId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('публичный запрос ограничен опубликованными подтверждёнными отзывами и безопасными полями автора', async () => {
    await expect(service.getProductReviews(productId)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(db.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            expect.objectContaining({
              productId,
              status: 'PUBLISHED',
              deletedAt: null,
              verifiedAt: { not: null },
            }),
          ]),
        },
      }),
    );
    expect(publicReviewsQuery.select.user).toEqual({
      select: { id: true, name: true, image: true },
    });
    expect(publicReviewsQuery.select.addenda.where).toMatchObject({
      status: 'PUBLISHED',
      publishedAt: { not: null },
    });
    const row = {
      id: 'review',
      publicationId,
      text: 'Текст',
      rating: 4,
      publishedAt: now,
      user: { id: 'owner', name: null, image: null },
      addenda: [
        {
          id: 'visible',
          publicationId,
          text: 'Через месяц.',
          createdAt: now,
          publishedAt: now,
        },
        {
          id: 'old',
          publicationId: 'old',
          text: 'Старое.',
          createdAt: now,
          publishedAt: now,
        },
      ],
    };
    expect(toPublicReviews([row])[0]).toMatchObject({
      verifiedPurchase: true,
      user: { name: 'Покупатель' },
      addenda: [{ id: 'visible' }],
    });
  });
});
