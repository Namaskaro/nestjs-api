import { randomUUID } from 'node:crypto';
import {
  REVIEW_COALESCE_MS,
  REVIEW_LEASE_MS,
  reviewRetryDelay,
} from '../core/review-policy';
import type { ReviewSummaryJobs, ReviewTextModels } from './ports';
import {
  generateReviewSummary,
  REVIEW_ANALYZER_VERSION,
  reviewSummaryHash,
  type ReviewSummaryInput,
} from './review-summary.model';

export class ReviewSummaries {
  private readonly stop = new AbortController();
  private running?: Promise<void>;

  constructor(
    private readonly jobs: ReviewSummaryJobs,
    private readonly models: ReviewTextModels,
    private readonly limits: () => {
      inputTokenBudget: number;
      maxCalls: number;
    },
    private readonly logger: {
      warn(event: Record<string, unknown>): void;
      log(event: Record<string, unknown>): void;
    },
  ) {}

  async close() {
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
    const productId = await this.jobs.summaryDue(now);
    if (!productId) return;
    const token = randomUUID();
    const leaseEnd = () => new Date(Date.now() + REVIEW_LEASE_MS);
    if (!(await this.jobs.claimSummary(productId, token, now, leaseEnd())))
      return;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, this.stop.signal]);
    const renew = async () => {
      signal.throwIfAborted();
      if (
        !(await this.jobs.renewSummary(
          productId,
          token,
          new Date(),
          leaseEnd(),
        ))
      ) {
        abort.abort();
        throw new Error('REVIEW_SUMMARY_LEASE_LOST');
      }
    };
    const heartbeat = setInterval(() => {
      void renew().catch(() => abort.abort());
    }, REVIEW_LEASE_MS / 3);
    try {
      await this.generate(productId, token, signal, renew);
    } catch (error) {
      const attempt = await this.jobs.summaryAttempt(productId, token);
      if (attempt === null) return;
      const code =
        error instanceof Error && /^REVIEW_SUMMARY_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'REVIEW_SUMMARY_GENERATION_FAILED';
      await this.jobs.retrySummary(
        productId,
        token,
        code,
        new Date(Date.now() + reviewRetryDelay(attempt)),
        /BUDGET|CONFIGURATION|EMPTY_CORPUS/.test(code),
      );
      this.logger.warn({
        event: 'review_summary_attempt_failed',
        productId,
        code,
        attempt,
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
    const { state, rows } = await this.jobs.summarySnapshot(productId);
    if (!state || state.leaseToken !== token)
      throw new Error('REVIEW_SUMMARY_LEASE_LOST');
    const authorCount = new Set(rows.map((row) => row.author.id)).size;
    if (rows.length < 10 || authorCount < 10) {
      await this.jobs.clearSummary(productId, token);
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
      : await generateReviewSummary(this.models, inputs, {
          ...this.limits(),
          signal,
          checkLease,
        });
    signal.throwIfAborted();
    await checkLease();
    const latest = await this.jobs.summaryState(productId);
    if (
      !latest ||
      latest.leaseToken !== token ||
      latest.lastRetractionVersion > state.corpusVersion
    )
      throw new Error('REVIEW_SUMMARY_INPUT_RETRACTED');
    const now = new Date();
    const saved = await this.jobs.saveSummary(
      productId,
      token,
      now,
      latest.requestedVersion,
      {
        ...result.output,
        generatedAt: now,
        sourceReviewCount: rows.length,
        sourceAuthorCount: authorCount,
        sourceVersion: state.corpusVersion,
        sourceHash: hash,
        analyzerVersion: REVIEW_ANALYZER_VERSION,
        nextAttemptAt:
          latest.requestedVersion > state.corpusVersion
            ? new Date(now.getTime() + REVIEW_COALESCE_MS)
            : null,
      },
    );
    if (!saved) throw new Error('REVIEW_SUMMARY_INPUT_RETRACTED');
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
