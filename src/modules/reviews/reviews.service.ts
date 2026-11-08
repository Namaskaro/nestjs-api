import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/generated';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { OrderItemRecordSchema } from '../orders/core/order-record.schema';
import { CreateReviewDto, normalizeReviewText } from './dto/create-review.dto';
import {
  CreateReviewAddendumDto,
  ModerateReviewDto,
} from './dto/review-actions.dto';
import {
  publishedReviewWhere,
  publicReviewsQuery,
  toPublicReviews,
  reviewPageRequest,
  nextReviewCursor,
  reviewPopularityScore,
} from './review-publication';
import { ReviewListQueryDto, ReviewVoteDto } from './dto/review-list.dto';
import {
  isReviewSummaryMilestone,
  nextReviewSummaryCount,
} from './review-summary.model';

const addendumSelect = {
  id: true,
  publicationId: true,
  text: true,
  status: true,
  createdAt: true,
  publishedAt: true,
  moderatedAt: true,
  moderationReason: true,
} satisfies Prisma.ReviewAddendumSelect;

const ownerReviewSelect = {
  id: true,
  productId: true,
  publicationId: true,
  text: true,
  rating: true,
  status: true,
  submittedAt: true,
  publishedAt: true,
  moderatedAt: true,
  moderationReason: true,
  deletedAt: true,
  addenda: {
    select: addendumSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ReviewSelect;

const reviewStateSelect = {
  id: true,
  userId: true,
  productId: true,
  publicationId: true,
  text: true,
  rating: true,
  status: true,
  deletedAt: true,
  stateVersion: true,
  upVotes: true,
  downVotes: true,
  popularityScore: true,
  publishedCorpusVersion: true,
} satisfies Prisma.ReviewSelect;

type ReviewState = Prisma.ReviewGetPayload<{
  select: typeof reviewStateSelect;
}>;

// Отметка и публикация фиксируются одной транзакцией; сетевых вызовов здесь нет.
function pendingReviewIndex() {
  return {
    indexPending: true,
    indexNextAttemptAt: new Date(),
    indexLeaseToken: null,
    indexLeaseUntil: null,
    indexAttempts: 0,
  };
}
type ReviewOwnerRow = Prisma.ReviewGetPayload<{
  select: typeof ownerReviewSelect;
}>;

function changed(): never {
  throw new ConflictException({
    code: 'REVIEW_STATE_CHANGED',
    message: 'Состояние отзыва изменилось. Обновите данные и повторите запрос.',
  });
}

function hasCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

function checkedText(value: unknown): string {
  const text = normalizeReviewText(value);
  if (
    typeof text !== 'string' ||
    !text.length ||
    text.length > 4000 ||
    text.includes('\0')
  ) {
    throw new BadRequestException({
      code: 'INVALID_REVIEW_TEXT',
      message: 'Нужен текст длиной от 1 до 4000 символов.',
    });
  }
  return text;
}

function checkedRating(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new BadRequestException({
      code: 'INVALID_REVIEW_RATING',
      message: 'Оценка должна быть целым числом от 1 до 5.',
    });
  }
  return value;
}

function checkedModeration(data: ModerateReviewDto): string | null {
  if (data.decision !== 'PUBLISHED' && data.decision !== 'REJECTED') {
    throw new BadRequestException({ code: 'INVALID_MODERATION_DECISION' });
  }
  const reason =
    data.reason === undefined ? '' : normalizeReviewText(data.reason);
  if (
    typeof reason !== 'string' ||
    reason.length > 500 ||
    reason.includes('\0')
  ) {
    throw new BadRequestException({ code: 'INVALID_MODERATION_REASON' });
  }
  return reason || null;
}

function ownerView(row: ReviewOwnerRow) {
  return {
    ...row,
    addenda: row.addenda.filter(
      (entry) => entry.publicationId === row.publicationId,
    ),
  };
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getProductReviews(
    productId: string,
    query: ReviewListQueryDto = new ReviewListQueryDto(),
  ) {
    await this.requireProduct(this.prismaService, productId);
    const page = reviewPageRequest(productId, query);
    const rows = await this.prismaService.review.findMany({
      ...publicReviewsQuery,
      where: page.where,
      orderBy: page.orderBy,
      take: page.take + 1,
    });
    const visible = rows.slice(0, page.take);
    return {
      items: toPublicReviews(visible),
      nextCursor:
        rows.length > page.take
          ? nextReviewCursor(
              productId,
              page.sort,
              page.asOf,
              visible[visible.length - 1],
            )
          : null,
    };
  }

  async getProductStats(productId: string) {
    await this.requireProduct(this.prismaService, productId);
    const where = { ...publishedReviewWhere, productId };
    const totalsQuery = this.prismaService.review.aggregate({
      where,
      _avg: { rating: true },
      _count: { _all: true },
    });
    const ratingsQuery = this.prismaService.review.groupBy({
      by: ['rating'],
      where,
      _count: { _all: true },
    });
    const [totals, ratings] = await this.prismaService.$transaction(
      [totalsQuery, ratingsQuery],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const positiveCount = ratings
      .filter((row) => row.rating >= 4)
      .reduce((sum, row) => sum + row._count._all, 0);
    const neutralCount = ratings
      .filter((row) => row.rating === 3)
      .reduce((sum, row) => sum + row._count._all, 0);
    const negativeCount = ratings
      .filter((row) => row.rating <= 2)
      .reduce((sum, row) => sum + row._count._all, 0);
    const ratingCount = totals._count._all;
    return {
      averageRating: totals._avg.rating,
      ratingCount,
      positiveCount,
      neutralCount,
      negativeCount,
      positivePercent: ratingCount ? (positiveCount * 100) / ratingCount : 0,
    };
  }

  async getOwnVotes(userId: string, productId: string, ids: string[]) {
    const rows = await this.prismaService.reviewVote.findMany({
      where: {
        userId,
        reviewId: { in: ids },
        review: { is: { ...publishedReviewWhere, productId } },
      },
      select: {
        reviewId: true,
        publicationId: true,
        value: true,
        review: { select: { publicationId: true } },
      },
    });
    return rows
      .filter((row) => row.publicationId === row.review.publicationId)
      .map(({ review, ...vote }) => vote);
  }

  async getProductStatsBatch(
    productIds: readonly string[],
    db: Pick<Prisma.TransactionClient, 'review'> = this.prismaService,
  ) {
    const ids = [...new Set(productIds)];
    const stats = new Map(
      ids.map((id) => [
        id,
        {
          averageRating: null as number | null,
          ratingCount: 0,
          positiveCount: 0,
          neutralCount: 0,
          negativeCount: 0,
          positivePercent: 0,
        },
      ]),
    );
    if (!ids.length) return stats;
    const groups = await db.review.groupBy({
      by: ['productId', 'rating'],
      where: { ...publishedReviewWhere, productId: { in: ids } },
      _count: { _all: true },
    });
    const sums = new Map<string, number>();
    for (const row of groups) {
      const current = stats.get(row.productId);
      const n = row._count._all;
      current.ratingCount += n;
      sums.set(row.productId, (sums.get(row.productId) ?? 0) + row.rating * n);
      if (row.rating >= 4) current.positiveCount += n;
      else if (row.rating === 3) current.neutralCount += n;
      else current.negativeCount += n;
    }
    for (const [id, current] of stats)
      if (current.ratingCount) {
        current.averageRating = sums.get(id) / current.ratingCount;
        current.positivePercent =
          (current.positiveCount * 100) / current.ratingCount;
      }
    return stats;
  }

  async getReviewExperience(productIds: readonly string[]) {
    return this.prismaService.$transaction(
      async (tx) => {
        const stats = await this.getProductStatsBatch(productIds, tx);
        const summaries = await tx.reviewSummary.findMany({
          where: {
            productId: { in: [...stats.keys()] },
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
        return new Map(
          [...stats].map(([productId, rating]) => {
            const summary = summaries.find(
              (row) => row.productId === productId,
            );
            return [
              productId,
              {
                ...rating,
                summary: summary
                  ? {
                      ...summary,
                      generatedAt: summary.generatedAt.toISOString(),
                    }
                  : null,
              },
            ];
          }),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async setVote(userId: string, reviewId: string, data: ReviewVoteDto) {
    if (!['UP', 'DOWN', null].includes(data.value))
      throw new BadRequestException({ code: 'INVALID_REVIEW_VOTE' });
    return this.transaction(async (tx) => {
      const row = await tx.review.findFirst({
        where: { ...publishedReviewWhere, id: reviewId },
        select: reviewStateSelect,
      });
      if (!row) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });
      this.requireCurrentPublication(row, data.publicationId);
      if (row.userId === userId)
        throw new BadRequestException({
          code: 'REVIEW_SELF_VOTE',
          message: 'За собственный отзыв голосовать нельзя.',
        });
      const current = await tx.reviewVote.findUnique({
        where: { reviewId_userId: { reviewId, userId } },
      });
      const previous =
        current?.publicationId === row.publicationId ? current.value : null;
      if (previous === data.value)
        return {
          reviewId,
          publicationId: row.publicationId,
          upVotes: row.upVotes,
          downVotes: row.downVotes,
          myVote: previous,
        };
      const upVotes =
        row.upVotes - Number(previous === 'UP') + Number(data.value === 'UP');
      const downVotes =
        row.downVotes -
        Number(previous === 'DOWN') +
        Number(data.value === 'DOWN');
      if (upVotes < 0 || downVotes < 0) changed();
      const updated = await tx.review.updateMany({
        where: {
          ...publishedReviewWhere,
          id: reviewId,
          publicationId: row.publicationId,
          stateVersion: row.stateVersion,
        },
        data: {
          upVotes,
          downVotes,
          popularityScore: reviewPopularityScore(upVotes, downVotes),
          stateVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) changed();
      if (data.value === null)
        await tx.reviewVote.deleteMany({
          where: { reviewId, userId, publicationId: row.publicationId },
        });
      else
        await tx.reviewVote.upsert({
          where: { reviewId_userId: { reviewId, userId } },
          create: {
            reviewId,
            userId,
            publicationId: row.publicationId,
            value: data.value,
          },
          update: { publicationId: row.publicationId, value: data.value },
        });
      return {
        reviewId,
        publicationId: row.publicationId,
        upVotes,
        downVotes,
        myVote: data.value,
      };
    });
  }

  async getMineAndEligibility(userId: string, productId: string) {
    await this.requireProduct(this.prismaService, productId);
    const row = await this.prismaService.review.findUnique({
      where: { userId_productId: { userId, productId } },
      select: ownerReviewSelect,
    });
    if (row && !row.deletedAt) {
      return {
        canCreate: false,
        reason: 'REVIEW_EXISTS',
        review: ownerView(row),
      };
    }
    const purchase = await this.findDeliveredPurchase(
      this.prismaService,
      userId,
      productId,
    );
    return {
      canCreate: !!purchase,
      reason: purchase ? null : 'NO_DELIVERED_PURCHASE',
      review: null,
    };
  }

  async createReview(userId: string, data: CreateReviewDto) {
    const text = checkedText(data.text);
    const rating = checkedRating(data.rating);
    try {
      return await this.transaction(async (tx) => {
        await this.requireProduct(tx, data.productId);
        const existing = await tx.review.findUnique({
          where: { userId_productId: { userId, productId: data.productId } },
          select: reviewStateSelect,
        });
        if (existing && !existing.deletedAt) {
          throw new ConflictException({
            code: 'REVIEW_EXISTS',
            message: 'У вас уже есть отзыв на этот товар.',
          });
        }
        const purchase = await this.requirePurchase(tx, userId, data.productId);
        const now = new Date();
        const content = {
          text,
          rating,
          publicationId: randomUUID(),
          status: 'PENDING' as const,
          submittedAt: now,
          publishedAt: null,
          moderatedAt: null,
          moderatedBy: null,
          moderationReason: null,
          verifiedOrderId: purchase.id,
          verifiedAt: now,
          deletedAt: null,
        };
        if (!existing) {
          return ownerView(
            await tx.review.create({
              data: { userId, productId: data.productId, ...content },
              select: ownerReviewSelect,
            }),
          );
        }
        const updated = await tx.review.updateMany({
          where: {
            id: existing.id,
            userId,
            deletedAt: { not: null },
            stateVersion: existing.stateVersion,
          },
          data: {
            ...content,
            stateVersion: { increment: 1 },
            upVotes: 0,
            downVotes: 0,
            popularityScore: 0,
            publishedCorpusVersion: null,
            ...pendingReviewIndex(),
          },
        });
        if (updated.count !== 1) changed();
        await tx.reviewAddendum.deleteMany({
          where: { reviewId: existing.id },
        });
        await tx.reviewVote.deleteMany({ where: { reviewId: existing.id } });
        return this.readOwner(tx, existing.id);
      });
    } catch (error) {
      if (hasCode(error, 'P2002')) {
        throw new ConflictException({
          code: 'REVIEW_EXISTS',
          message: 'У вас уже есть отзыв на этот товар.',
        });
      }
      throw error;
    }
  }

  async addAddendum(
    userId: string,
    reviewId: string,
    data: CreateReviewAddendumDto,
  ) {
    const text = checkedText(data.text);
    return this.transaction(async (tx) => {
      const review = await this.ownedReview(tx, userId, reviewId);
      this.requireCurrentPublication(review, data.publicationId);
      if (review.status !== 'PUBLISHED' || review.deletedAt) {
        throw new ConflictException({
          code: 'REVIEW_NOT_PUBLISHED',
          message: 'Дополнить можно только опубликованный отзыв.',
        });
      }
      await this.claimPublishedReview(tx, review);
      return tx.reviewAddendum.create({
        data: { reviewId, publicationId: review.publicationId, text },
        select: addendumSelect,
      });
    });
  }

  async deleteReview(
    userId: string,
    reviewId: string,
    publicationId: string,
  ): Promise<void> {
    return this.transaction(async (tx) => {
      const review = await this.ownedReview(tx, userId, reviewId);
      this.requireCurrentPublication(review, publicationId);
      if (review.deletedAt) return;
      const result = await tx.review.updateMany({
        where: {
          id: reviewId,
          userId,
          publicationId,
          deletedAt: null,
          stateVersion: review.stateVersion,
        },
        data: {
          deletedAt: new Date(),
          stateVersion: { increment: 1 },
          upVotes: 0,
          downVotes: 0,
          popularityScore: 0,
          ...pendingReviewIndex(),
        },
      });
      if (result.count !== 1) changed();
      await tx.reviewVote.deleteMany({ where: { reviewId } });
      if (review.status === 'PUBLISHED' && review.productId)
        await this.recordCorpusChange(tx, review, 'delete');
    });
  }

  async getModerationQueue(kind: 'review' | 'addendum' = 'review') {
    if (kind === 'addendum') {
      const rows = await this.prismaService.reviewAddendum.findMany({
        where: { status: 'PENDING', review: { is: publishedReviewWhere } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50,
        select: {
          ...addendumSelect,
          reviewId: true,
          review: {
            select: {
              publicationId: true,
              productId: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      });
      return rows.filter(
        (row) => row.publicationId === row.review.publicationId,
      );
    }
    return this.prismaService.review.findMany({
      where: { status: 'PENDING', deletedAt: null },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: 50,
      select: {
        ...ownerReviewSelect,
        user: { select: { id: true, name: true } },
      },
    });
  }

  async moderateReview(
    moderatorId: string,
    reviewId: string,
    data: ModerateReviewDto,
  ) {
    const reason = checkedModeration(data);
    return this.transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id: reviewId },
        select: reviewStateSelect,
      });
      if (!review) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });
      this.requireCurrentPublication(review, data.publicationId);
      if (review.deletedAt) changed();
      if (review.status !== 'PENDING') {
        if (review.status === data.decision)
          return this.readOwner(tx, reviewId);
        throw new ConflictException({ code: 'REVIEW_ALREADY_MODERATED' });
      }
      let verification:
        | { verifiedOrderId: string; verifiedAt: Date }
        | undefined;
      if (data.decision === 'PUBLISHED') {
        checkedText(review.text);
        checkedRating(review.rating);
        if (!review.userId || !review.productId) {
          throw new BadRequestException({ code: 'REVIEW_PURCHASE_UNVERIFIED' });
        }
        await this.requireProduct(tx, review.productId);
        const purchase = await this.requirePurchase(
          tx,
          review.userId,
          review.productId,
        );
        verification = { verifiedOrderId: purchase.id, verifiedAt: new Date() };
      }
      const now = new Date();
      const result = await tx.review.updateMany({
        where: {
          id: reviewId,
          publicationId: data.publicationId,
          status: 'PENDING',
          deletedAt: null,
          stateVersion: review.stateVersion,
        },
        data: {
          status: data.decision,
          moderatedAt: now,
          moderatedBy: moderatorId,
          moderationReason: reason,
          publishedAt: data.decision === 'PUBLISHED' ? now : null,
          stateVersion: { increment: 1 },
          ...verification,
          ...(data.decision === 'PUBLISHED' ? pendingReviewIndex() : {}),
        },
      });
      if (result.count !== 1) changed();
      if (data.decision === 'PUBLISHED')
        await this.recordCorpusChange(tx, review, 'review');
      return this.readOwner(tx, reviewId);
    });
  }

  async moderateAddendum(
    moderatorId: string,
    addendumId: string,
    data: ModerateReviewDto,
  ) {
    const reason = checkedModeration(data);
    return this.transaction(async (tx) => {
      const entry = await tx.reviewAddendum.findUnique({
        where: { id: addendumId },
      });
      if (!entry)
        throw new NotFoundException({ code: 'REVIEW_ADDENDUM_NOT_FOUND' });
      const review = await tx.review.findUnique({
        where: { id: entry.reviewId },
        select: reviewStateSelect,
      });
      if (!review) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });
      this.requireCurrentPublication(review, data.publicationId);
      if (
        entry.publicationId !== data.publicationId ||
        review.deletedAt ||
        review.status !== 'PUBLISHED'
      )
        changed();
      if (entry.status !== 'PENDING') {
        if (entry.status === data.decision) {
          return tx.reviewAddendum.findUnique({
            where: { id: addendumId },
            select: addendumSelect,
          });
        }
        throw new ConflictException({ code: 'REVIEW_ALREADY_MODERATED' });
      }
      if (data.decision === 'PUBLISHED') checkedText(entry.text);
      await this.claimPublishedReview(tx, review);
      const now = new Date();
      const result = await tx.reviewAddendum.updateMany({
        where: {
          id: addendumId,
          publicationId: data.publicationId,
          status: 'PENDING',
        },
        data: {
          status: data.decision,
          moderatedAt: now,
          moderatedBy: moderatorId,
          moderationReason: reason,
          publishedAt: data.decision === 'PUBLISHED' ? now : null,
        },
      });
      if (result.count !== 1) changed();
      if (data.decision === 'PUBLISHED') {
        await tx.review.updateMany({
          where: { id: review.id, publicationId: review.publicationId },
          data: pendingReviewIndex(),
        });
        await this.recordCorpusChange(tx, review, 'addendum', addendumId);
      }
      return tx.reviewAddendum.findUnique({
        where: { id: addendumId },
        select: addendumSelect,
      });
    });
  }

  private async recordCorpusChange(
    tx: Prisma.TransactionClient,
    review: ReviewState,
    kind: 'review' | 'addendum' | 'delete',
    addendumId?: string,
  ) {
    const productId = review.productId;
    const state = await tx.reviewSummary.upsert({
      where: { productId },
      create: { productId, corpusVersion: 1 },
      update: { corpusVersion: { increment: 1 } },
    });
    if (kind === 'review')
      await tx.review.updateMany({
        where: { id: review.id, publicationId: review.publicationId },
        data: { publishedCorpusVersion: state.corpusVersion },
      });
    if (kind === 'addendum') {
      await tx.reviewAddendum.updateMany({
        where: {
          id: addendumId,
          reviewId: review.id,
          publicationId: review.publicationId,
        },
        data: { publishedCorpusVersion: state.corpusVersion },
      });
      return; // Дополнения не меняют requestedVersion или очередь генерации.
    }
    const count = await tx.review.count({
      where: { ...publishedReviewWhere, productId },
    });
    const now = new Date();
    const due =
      state.nextAttemptAt &&
      state.nextAttemptAt < new Date(now.getTime() + 30_000)
        ? state.nextAttemptAt
        : new Date(now.getTime() + 30_000);
    if (kind === 'review') {
      const base = state.summary === null ? 0 : state.sourceReviewCount;
      if (
        count >= nextReviewSummaryCount(base) &&
        (!state.nextAttemptAt || isReviewSummaryMilestone(base, count))
      )
        await tx.reviewSummary.update({
          where: { productId },
          data: {
            requestedVersion: state.corpusVersion,
            nextAttemptAt: due,
            attemptCount: 0,
            lastErrorCode: null,
          },
        });
      return;
    }
    const included =
      state.summary !== null &&
      (review.publishedCorpusVersion === null ||
        review.publishedCorpusVersion <= state.sourceVersion);
    const invalidate = included || count < 10;
    const requested = count >= 10 && (included || state.nextAttemptAt !== null);
    await tx.reviewSummary.update({
      where: { productId },
      data: {
        lastRetractionVersion: state.corpusVersion,
        ...(invalidate
          ? {
              summary: null,
              generatedAt: null,
              positiveImpressions: [],
              negativeImpressions: [],
              sourceHash: null,
            }
          : {}),
        ...(requested
          ? {
              requestedVersion: state.corpusVersion,
              nextAttemptAt: due,
              attemptCount: 0,
              lastErrorCode: null,
            }
          : {}),
        ...(count < 10 ? { nextAttemptAt: null } : {}),
        // Немедленная отмена lease старого задания; heartbeat также остановит LLM.
        leaseToken: null,
        leaseUntil: null,
      },
    });
  }

  private async requireProduct(
    db: Pick<Prisma.TransactionClient, 'product'>,
    productId: string,
  ) {
    if (
      !(await db.product.findUnique({
        where: { id: productId },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Товар не найден.',
      });
    }
  }

  private async findDeliveredPurchase(
    db: Pick<Prisma.TransactionClient, 'order'>,
    userId: string,
    productId: string,
  ) {
    const orders = await db.order.findMany({
      where: {
        userId,
        status: 'DELIVERED',
        items: { array_contains: [{ productId }] },
      },
      select: { id: true, items: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return (
      orders.find((order) => {
        const parsed = OrderItemRecordSchema.array().safeParse(order.items);
        return (
          parsed.success &&
          parsed.data.some((item) => item.productId === productId)
        );
      }) ?? null
    );
  }

  private async requirePurchase(
    db: Pick<Prisma.TransactionClient, 'order'>,
    userId: string,
    productId: string,
  ) {
    const purchase = await this.findDeliveredPurchase(db, userId, productId);
    if (!purchase) {
      throw new BadRequestException({
        code: 'NO_DELIVERED_PURCHASE',
        message:
          'Для отзыва нужна подтверждённая доставленная покупка этого товара.',
      });
    }
    return purchase;
  }

  private async ownedReview(
    tx: Prisma.TransactionClient,
    userId: string,
    reviewId: string,
  ) {
    const review = await tx.review.findFirst({
      where: { id: reviewId, userId },
      select: reviewStateSelect,
    });
    if (!review) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });
    return review;
  }

  private requireCurrentPublication(
    review: ReviewState,
    publicationId: string,
  ) {
    if (review.publicationId !== publicationId) changed();
  }

  private async claimPublishedReview(
    tx: Prisma.TransactionClient,
    review: ReviewState,
  ) {
    const result = await tx.review.updateMany({
      where: {
        id: review.id,
        publicationId: review.publicationId,
        status: 'PUBLISHED',
        deletedAt: null,
        stateVersion: review.stateVersion,
      },
      data: { stateVersion: { increment: 1 } },
    });
    if (result.count !== 1) changed();
  }

  private async readOwner(tx: Prisma.TransactionClient, reviewId: string) {
    const row = await tx.review.findUnique({
      where: { id: reviewId },
      select: ownerReviewSelect,
    });
    if (!row) throw new NotFoundException({ code: 'REVIEW_NOT_FOUND' });
    return ownerView(row);
  }

  private async transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prismaService.$transaction(action, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (hasCode(error, 'P2034')) changed();
      throw error;
    }
  }
}
