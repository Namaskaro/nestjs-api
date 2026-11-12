import { createHash, randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { reviewSources, type ReviewSourceRef } from '../core/review-model';
import {
  REVIEW_LEASE_MS,
  REVIEW_MAX_ATTEMPTS,
  reviewRetryDelay,
} from '../core/review-policy';
import {
  assertReviewStore,
  type ReviewEmbeddings,
  type ReviewEvidenceLookup,
  type ReviewIndexJobs,
  type ReviewProductLookup,
  type ReviewSourcePort,
  type ReviewVectorIndex,
} from './ports';

export class ReviewIndexError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REVIEW_SOURCES'
      | 'INVALID_REVIEW_QUERY'
      | 'PRODUCT_NOT_FOUND'
      | 'REVIEW_SEARCH_UNAVAILABLE',
  ) {
    super(code);
  }
}

export class ReviewIndex implements ReviewEvidenceLookup {
  private readonly abort = new AbortController();
  private running?: Promise<void>;

  constructor(
    private readonly source: ReviewSourcePort & ReviewProductLookup,
    private readonly jobs: ReviewIndexJobs,
    private readonly vectors: ReviewVectorIndex,
    private readonly embeddings: ReviewEmbeddings,
    private readonly logger: { warn(event: Record<string, unknown>): void },
  ) {
    assertReviewStore(source, jobs, vectors);
  }

  initializeCollection(): Promise<void> {
    return this.vectors.initialize(this.embeddings.space().dimensions);
  }

  async close() {
    this.abort.abort();
    await this.running;
  }

  async resolveSources(productId: string, refs: readonly ReviewSourceRef[]) {
    if (
      refs.length > 16 ||
      refs.some(
        (ref) =>
          !isUUID(ref.reviewId) ||
          !isUUID(ref.publicationId) ||
          !isUUID(ref.sourceId),
      )
    )
      throw new ReviewIndexError('INVALID_REVIEW_SOURCES');
    const rows = reviewSources(
      await this.source.listPublished(
        [...new Set(refs.map((ref) => ref.reviewId))],
        productId,
      ),
    );
    const byId = new Map(rows.map((row) => [row.sourceId, row]));
    return refs.flatMap((ref) => {
      const row = byId.get(ref.sourceId);
      return row?.productId === productId &&
        row.reviewId === ref.reviewId &&
        row.publicationId === ref.publicationId
        ? [row]
        : [];
    });
  }

  async search(productId: string, query: string, signal?: AbortSignal) {
    const text = query.trim();
    if (!isUUID(productId) || !text || text.length > 500)
      throw new ReviewIndexError('INVALID_REVIEW_QUERY');
    if (!(await this.source.productExists(productId)))
      throw new ReviewIndexError('PRODUCT_NOT_FOUND');
    if (!(await this.source.hasPublished(productId))) return [];
    try {
      const { dimensions, version } = this.embeddings.space();
      await this.vectors.validate(dimensions);
      const vector = await this.embeddings.embedQuery(text, signal);
      signal?.throwIfAborted();
      const refs = await this.vectors.search(productId, text, vector, version);
      return this.resolveSources(productId, refs);
    } catch {
      signal?.throwIfAborted();
      this.logger.warn({ event: 'review_retrieval_unavailable' });
      throw new ReviewIndexError('REVIEW_SEARCH_UNAVAILABLE');
    }
  }

  runPending(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.poll().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async poll() {
    if (this.abort.signal.aborted) return;
    const now = new Date();
    const ids = await this.jobs.indexDue(now);
    if (!ids.length) return;
    await this.initializeCollection();
    for (const id of ids) {
      if (this.abort.signal.aborted) break;
      const token = randomUUID();
      if (!(await this.jobs.claimIndex(id, token, now, this.leaseEnd())))
        continue;
      const heartbeat = setInterval(() => {
        void this.jobs
          .renewIndex(id, token, this.leaseEnd())
          .catch(() => undefined);
      }, REVIEW_LEASE_MS / 3);
      try {
        await this.indexReview(id, token);
        await this.jobs.finishIndex(id, token);
      } catch {
        const attempts = await this.jobs.indexAttempt(id, token);
        if (attempts === null) continue;
        await this.jobs.retryIndex(
          id,
          token,
          new Date(Date.now() + reviewRetryDelay(attempts)),
        );
        this.logger.warn({
          event: 'review_index_attempt_failed',
          reviewId: id,
          attempts,
          exhausted: attempts >= REVIEW_MAX_ATTEMPTS,
        });
      } finally {
        clearInterval(heartbeat);
      }
    }
  }

  private leaseEnd() {
    return new Date(Date.now() + REVIEW_LEASE_MS);
  }

  private async hasLease(reviewId: string, token: string) {
    if (!(await this.jobs.indexLeaseValid(reviewId, token, new Date())))
      throw new Error('REVIEW_INDEX_LEASE_LOST');
  }

  private async indexReview(reviewId: string, token: string) {
    const { version } = this.embeddings.space();
    const sources = reviewSources(await this.source.listPublished([reviewId]));
    const points = await this.vectors.versions(
      sources.map((source) => source.sourceId),
    );
    try {
      for (const source of sources) {
        this.abort.signal.throwIfAborted();
        const hash = createHash('sha256').update(source.text).digest('hex');
        const existing = points.get(source.sourceId);
        if (existing?.hash === hash && existing.space === version) continue;
        const vector = await this.embeddings.embedDocument(
          source.text,
          this.abort.signal,
        );
        await this.hasLease(reviewId, token);
        await this.vectors.save(source, vector, version, hash);
      }
    } finally {
      // A lost upsert acknowledgement can still leave a point behind.
      try {
        await this.cleanup(reviewId);
      } catch (error) {
        await this.jobs.requestIndexCleanup(
          reviewId,
          new Date(Date.now() + 30_000),
        );
        throw error;
      }
    }
    await this.hasLease(reviewId, token);
  }

  private async cleanup(reviewId: string) {
    // Inspect IDs before checking the latest authoritative publication.
    const inspected: string[] = [];
    let offset: string | number | undefined;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error('REVIEW_INDEX_CLEANUP_LIMIT');
      const result = await this.vectors.listByReview(reviewId, offset);
      inspected.push(...result.ids);
      if (result.next === undefined) break;
      offset = result.next;
    }
    const allowed = new Set(
      reviewSources(await this.source.listPublished([reviewId])).map(
        (source) => source.sourceId,
      ),
    );
    await this.vectors.remove(inspected.filter((id) => !allowed.has(id)));
  }
}
