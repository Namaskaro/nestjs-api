import { Prisma } from '@prisma/generated';
import type { PrismaService } from '@/src/core/prisma/prisma.service';
import type {
  ReviewIndexJobs,
  ReviewSummaryJobs,
  SummaryWrite,
} from '@/src/review-intelligence/application/ports';
import { REVIEW_MAX_ATTEMPTS } from '@/src/review-intelligence/core/review-policy';
import {
  NEXTSHOP_REVIEW_STORE,
  readPublishedReviews,
} from './nextshop-review-source';

function indexDue(now: Date): Prisma.ReviewWhereInput {
  return {
    indexPending: true,
    indexAttempts: { lt: REVIEW_MAX_ATTEMPTS },
    AND: [
      {
        OR: [
          { indexNextAttemptAt: null },
          { indexNextAttemptAt: { lte: now } },
        ],
      },
      { OR: [{ indexLeaseUntil: null }, { indexLeaseUntil: { lte: now } }] },
    ],
  };
}

function summaryDue(now: Date): Prisma.ReviewSummaryWhereInput {
  return {
    nextAttemptAt: { lte: now },
    attemptCount: { lt: REVIEW_MAX_ATTEMPTS },
    OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
  };
}

export class PrismaReviewJobs implements ReviewIndexJobs, ReviewSummaryJobs {
  readonly storeId = NEXTSHOP_REVIEW_STORE;

  constructor(private readonly prisma: PrismaService) {}

  async indexDue(now: Date) {
    const rows = await this.prisma.review.findMany({
      where: indexDue(now),
      orderBy: [{ indexNextAttemptAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: 5,
    });
    return rows.map(({ id }) => id);
  }

  async claimIndex(
    id: string,
    indexLeaseToken: string,
    now: Date,
    indexLeaseUntil: Date,
  ) {
    const result = await this.prisma.review.updateMany({
      where: { id, ...indexDue(now) },
      data: {
        indexLeaseToken,
        indexLeaseUntil,
        indexAttempts: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  async renewIndex(id: string, indexLeaseToken: string, indexLeaseUntil: Date) {
    await this.prisma.review.updateMany({
      where: { id, indexLeaseToken },
      data: { indexLeaseUntil },
    });
  }

  async indexLeaseValid(id: string, indexLeaseToken: string, now: Date) {
    return !!(await this.prisma.review.findFirst({
      where: { id, indexLeaseToken, indexLeaseUntil: { gt: now } },
      select: { id: true },
    }));
  }

  async indexAttempt(id: string, indexLeaseToken: string) {
    const row = await this.prisma.review.findFirst({
      where: { id, indexLeaseToken },
      select: { indexAttempts: true },
    });
    return row?.indexAttempts ?? null;
  }

  async finishIndex(id: string, indexLeaseToken: string) {
    await this.prisma.review.updateMany({
      where: { id, indexLeaseToken },
      data: {
        indexPending: false,
        indexNextAttemptAt: null,
        indexLeaseToken: null,
        indexLeaseUntil: null,
        indexAttempts: 0,
      },
    });
  }

  async retryIndex(
    id: string,
    indexLeaseToken: string,
    indexNextAttemptAt: Date,
  ) {
    await this.prisma.review.updateMany({
      where: { id, indexLeaseToken },
      data: {
        indexLeaseToken: null,
        indexLeaseUntil: null,
        indexNextAttemptAt,
      },
    });
  }

  async requestIndexCleanup(id: string, indexNextAttemptAt: Date) {
    await this.prisma.review.updateMany({
      where: { id },
      data: {
        indexPending: true,
        indexLeaseToken: null,
        indexLeaseUntil: null,
        indexNextAttemptAt,
      },
    });
  }

  async summaryDue(now: Date) {
    const row = await this.prisma.reviewSummary.findFirst({
      where: summaryDue(now),
      orderBy: [{ nextAttemptAt: 'asc' }, { productId: 'asc' }],
      select: { productId: true },
    });
    return row?.productId ?? null;
  }

  async claimSummary(
    productId: string,
    leaseToken: string,
    now: Date,
    leaseUntil: Date,
  ) {
    const result = await this.prisma.reviewSummary.updateMany({
      where: { productId, ...summaryDue(now) },
      data: { leaseToken, leaseUntil, attemptCount: { increment: 1 } },
    });
    return result.count === 1;
  }

  async renewSummary(
    productId: string,
    leaseToken: string,
    now: Date,
    leaseUntil: Date,
  ) {
    const result = await this.prisma.reviewSummary.updateMany({
      where: { productId, leaseToken, leaseUntil: { gt: now } },
      data: { leaseUntil },
    });
    return result.count === 1;
  }

  async summaryAttempt(productId: string, leaseToken: string) {
    const row = await this.prisma.reviewSummary.findFirst({
      where: { productId, leaseToken, nextAttemptAt: { not: null } },
      select: { attemptCount: true },
    });
    return row?.attemptCount ?? null;
  }

  async retrySummary(
    productId: string,
    leaseToken: string,
    lastErrorCode: string,
    nextAttemptAt: Date,
    exhausted: boolean,
  ) {
    await this.prisma.reviewSummary.updateMany({
      where: { productId, leaseToken, nextAttemptAt: { not: null } },
      data: {
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode,
        nextAttemptAt,
        ...(exhausted ? { attemptCount: REVIEW_MAX_ATTEMPTS } : {}),
      },
    });
  }

  summarySnapshot(productId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const state = await tx.reviewSummary.findUnique({
          where: { productId },
        });
        const rows = await readPublishedReviews(tx, {
          productId,
          oldestFirst: true,
        });
        return { state, rows };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async clearSummary(productId: string, leaseToken: string) {
    await this.prisma.reviewSummary.updateMany({
      where: { productId, leaseToken },
      data: {
        summary: null,
        generatedAt: null,
        positiveImpressions: [],
        negativeImpressions: [],
        nextAttemptAt: null,
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: null,
      },
    });
  }

  summaryState(productId: string) {
    return this.prisma.reviewSummary.findUnique({ where: { productId } });
  }

  async saveSummary(
    productId: string,
    leaseToken: string,
    now: Date,
    requestedVersion: number,
    result: SummaryWrite,
  ) {
    const saved = await this.prisma.reviewSummary.updateMany({
      where: {
        productId,
        leaseToken,
        leaseUntil: { gt: now },
        requestedVersion,
        lastRetractionVersion: { lte: result.sourceVersion },
      },
      data: {
        ...result,
        attemptCount: 0,
        lastErrorCode: null,
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return saved.count === 1;
  }
}
