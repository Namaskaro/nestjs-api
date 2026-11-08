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
} from './review-publication';

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
} satisfies Prisma.ReviewSelect;

type ReviewState = Prisma.ReviewGetPayload<{
  select: typeof reviewStateSelect;
}>;
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

  async getProductReviews(productId: string) {
    await this.requireProduct(this.prismaService, productId);
    return toPublicReviews(
      await this.prismaService.review.findMany({
        ...publicReviewsQuery,
        where: { ...publishedReviewWhere, productId },
      }),
    );
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
            indexPending: false,
            indexNextAttemptAt: null,
            indexLeaseToken: null,
            indexLeaseUntil: null,
            indexAttempts: 0,
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
        },
      });
      if (result.count !== 1) changed();
      await tx.reviewVote.deleteMany({ where: { reviewId } });
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
        },
      });
      if (result.count !== 1) changed();
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
      return tx.reviewAddendum.findUnique({
        where: { id: addendumId },
        select: addendumSelect,
      });
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
