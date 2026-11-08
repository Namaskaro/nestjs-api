import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/generated';
import { AiService } from '@/src/ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { publicReviewsQuery, publishedReviewWhere } from './review-publication';
import {
  generateReviewSummary,
  REVIEW_ANALYZER_VERSION,
  reviewSummaryHash,
  type ReviewSummaryInput,
} from './review-summary.model';

const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class ReviewSummaryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReviewSummaryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private readonly stop = new AbortController();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const enabled = this.config.get('REVIEW_SUMMARY_ENABLED') ?? 'false';
    if (!['true', 'false', true, false].includes(enabled))
      throw new Error('REVIEW_SUMMARY_ENABLED must be true or false');
    if (enabled !== true && enabled !== 'true') return;
    this.timer = setInterval(() => {
      void this.runPending().catch(() =>
        this.logger.error({ event: 'review_summary_poll_failed' }),
      );
    }, 30_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.stop.abort();
    await this.running;
  }

  runPending(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.poll().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async poll() {
    if (this.stop.signal.aborted) return;
    const now = new Date();
    const due = {
      nextAttemptAt: { lte: now },
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    };
    const job = await this.prisma.reviewSummary.findFirst({
      where: due,
      orderBy: [{ nextAttemptAt: 'asc' }, { productId: 'asc' }],
      select: { productId: true },
    });
    if (!job) return;
    const token = randomUUID();
    const claim = await this.prisma.reviewSummary.updateMany({
      where: { productId: job.productId, ...due },
      data: {
        leaseToken: token,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        attemptCount: { increment: 1 },
      },
    });
    if (!claim.count) return;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, this.stop.signal]);
    const renew = async () => {
      signal.throwIfAborted();
      const result = await this.prisma.reviewSummary.updateMany({
        where: {
          productId: job.productId,
          leaseToken: token,
          leaseUntil: { gt: new Date() },
        },
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (!result.count) {
        abort.abort();
        throw new Error('REVIEW_SUMMARY_LEASE_LOST');
      }
    };
    // Продлеваем lease и внутри длительного LLM-вызова, а не только между пакетами.
    const heartbeat = setInterval(() => {
      void renew().catch(() => abort.abort());
    }, LEASE_MS / 3);
    try {
      await this.generate(job.productId, token, signal, renew);
    } catch (error) {
      const row = await this.prisma.reviewSummary.findUnique({
        where: { productId: job.productId },
        select: { attemptCount: true },
      });
      const code =
        error instanceof Error && /^REVIEW_SUMMARY_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'REVIEW_SUMMARY_GENERATION_FAILED';
      const retryable = !/BUDGET|CONFIGURATION|EMPTY_CORPUS/.test(code);
      const delay = [30_000, 120_000, 600_000, 3_600_000][
        Math.min((row?.attemptCount ?? 1) - 1, 3)
      ];
      await this.prisma.reviewSummary.updateMany({
        // Удаление могло уже отменить задачу — не восстанавливаем её из catch.
        where: {
          productId: job.productId,
          leaseToken: token,
          nextAttemptAt: { not: null },
        },
        data: {
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: code,
          nextAttemptAt: new Date(Date.now() + delay),
          ...(!retryable ? { attemptCount: MAX_ATTEMPTS } : {}),
        },
      });
      this.logger.warn({
        event: 'review_summary_attempt_failed',
        productId: job.productId,
        code,
        attempt: row?.attemptCount,
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async generate(
    productId: string,
    token: string,
    signal: AbortSignal,
    checkLease: () => Promise<void>,
  ) {
    const startedAt = Date.now();
    const snapshot = await this.prisma.$transaction(
      async (tx) => {
        const state = await tx.reviewSummary.findUnique({
          where: { productId },
        });
        const rows = await tx.review.findMany({
          ...publicReviewsQuery,
          where: { ...publishedReviewWhere, productId },
          orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
        });
        return { state, rows };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const { state, rows } = snapshot;
    if (!state || state.leaseToken !== token)
      throw new Error('REVIEW_SUMMARY_LEASE_LOST');
    const authorCount = new Set(rows.map((row) => row.user?.id).filter(Boolean))
      .size;
    if (rows.length < 10 || authorCount < 10) {
      await this.prisma.reviewSummary.updateMany({
        where: { productId, leaseToken: token },
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
      return;
    }
    const inputs: ReviewSummaryInput[] = rows.flatMap((row) => [
      {
        id: row.id,
        publicationId: row.publicationId,
        text: row.text,
        kind: 'review' as const,
      },
      ...row.addenda
        .filter((entry) => entry.publicationId === row.publicationId)
        .map((entry) => ({
          id: entry.id,
          publicationId: row.publicationId,
          text: entry.text,
          kind: 'addendum' as const,
        })),
    ]);
    const hash = reviewSummaryHash(inputs);
    const reused =
      state.sourceHash === hash &&
      state.summary !== null &&
      state.analyzerVersion === REVIEW_ANALYZER_VERSION;
    const result = reused
      ? {
          output: {
            positiveImpressions: state.positiveImpressions,
            negativeImpressions: state.negativeImpressions,
            summary: state.summary,
          },
          calls: 0,
        }
      : await generateReviewSummary(this.ai, inputs, {
          inputTokenBudget: Number(
            this.config.get('REVIEW_SUMMARY_INPUT_TOKENS') ?? 6000,
          ),
          maxCalls: Number(this.config.get('REVIEW_SUMMARY_MAX_CALLS') ?? 32),
          signal,
          checkLease,
        });
    signal.throwIfAborted();
    await checkLease();
    const latest = await this.prisma.reviewSummary.findUnique({
      where: { productId },
    });
    if (
      !latest ||
      latest.leaseToken !== token ||
      latest.lastRetractionVersion > state.corpusVersion
    )
      throw new Error('REVIEW_SUMMARY_INPUT_RETRACTED');
    const pending = latest.requestedVersion > state.corpusVersion;
    const saved = await this.prisma.reviewSummary.updateMany({
      where: {
        productId,
        leaseToken: token,
        leaseUntil: { gt: new Date() },
        lastRetractionVersion: { lte: state.corpusVersion },
        requestedVersion: latest.requestedVersion,
      },
      data: {
        ...result.output,
        generatedAt: new Date(),
        sourceReviewCount: rows.length,
        sourceAuthorCount: authorCount,
        sourceVersion: state.corpusVersion,
        sourceHash: hash,
        analyzerVersion: REVIEW_ANALYZER_VERSION,
        attemptCount: 0,
        lastErrorCode: null,
        leaseToken: null,
        leaseUntil: null,
        nextAttemptAt: pending ? new Date(Date.now() + 30_000) : null,
      },
    });
    if (!saved.count) throw new Error('REVIEW_SUMMARY_INPUT_RETRACTED');
    this.logger.log({
      event: 'review_summary_generated',
      productId,
      sourceVersion: state.corpusVersion,
      reviewCount: rows.length,
      authorCount,
      calls: result.calls,
      reused,
      durationMs: Date.now() - startedAt,
    });
  }
}
