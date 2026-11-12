import type { QdrantService } from '@/src/core/qdrant/qdrant.service';
import {
  PostgresReviewState,
  type ReviewPgPool,
} from './adapters/postgres-review-state';
import { QdrantReviewIndex } from './adapters/qdrant-review-index';
import type { ReviewFeed } from './application/review-feed';
import type { ReviewEmbeddings, ReviewTextModels } from './application/ports';
import { answerProductReviewQuestion } from './application/review-answer';
import { readReviewExperience } from './application/review-experience';
import { ReviewIndex } from './application/review-index';
import { ReviewSummaries } from './application/review-summary';

/** Compose in an existing Node host with trusted, store-bound source credentials. */
export function createPortableReviewRuntime(options: {
  postgres: ReviewPgPool;
  qdrant: QdrantService;
  feed: ReviewFeed;
  text: ReviewTextModels;
  embeddings: ReviewEmbeddings;
  summaryLimits: () => { inputTokenBudget: number; maxCalls: number };
  logger: {
    warn(event: Record<string, unknown>): void;
    log(event: Record<string, unknown>): void;
  };
}) {
  const { feed, text, embeddings, logger } = options;
  const state = new PostgresReviewState(options.postgres, feed);
  const vectors = new QdrantReviewIndex(options.qdrant, state.storeId);
  const index = new ReviewIndex(feed, state, vectors, embeddings, logger);
  const summaries = new ReviewSummaries(
    state,
    text,
    options.summaryLimits,
    logger,
  );

  return {
    initialize: () => index.initializeCollection(),
    synchronize: (limit?: number) => state.synchronize(limit),
    async runPending() {
      await index.runPending();
      await summaries.runPending();
    },
    experience: (ids: readonly string[]) => readReviewExperience(state, ids),
    search: index.search.bind(index),
    resolveSources: index.resolveSources.bind(index),
    answer: (productId: string, query: string, signal?: AbortSignal) =>
      answerProductReviewQuestion(text, index, { productId, query, signal }),
    async close() {
      await Promise.all([index.close(), summaries.close()]);
    },
  };
}
