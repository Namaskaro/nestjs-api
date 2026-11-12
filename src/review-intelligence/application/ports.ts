import type { ZodType } from 'zod';
import type {
  PublishedReview,
  RatingGroup,
  ReviewExperience,
  ReviewSource,
  ReviewSourceRef,
  ReviewStats,
  ReviewSummaryEvidence,
  SummaryImpressions,
} from '../core/review-model';

/** Trusted store binding supplied by composition, never by the client. */
export interface ReviewStoreBinding {
  readonly storeId: string;
}

export function assertReviewStore(...bindings: ReviewStoreBinding[]) {
  const store = bindings[0]?.storeId;
  if (!store || bindings.some(({ storeId }) => storeId !== store))
    throw new Error('REVIEW_STORE_MISMATCH');
}

export interface ReviewProductLookup extends ReviewStoreBinding {
  productExists(productId: string): Promise<boolean>;
}

export interface ReviewSourcePort extends ReviewStoreBinding {
  /**
   * Read current public revisions from the authority for this store.
   * A changed review gets a new publication ID. Withdrawn sources disappear
   * here immediately, independently of the derived index and worker schedule.
   */
  listPublished(
    reviewIds: readonly string[],
    productId?: string,
  ): Promise<PublishedReview[]>;
  hasPublished(productId: string): Promise<boolean>;
}

export interface ReviewExperiencePort extends ReviewStoreBinding {
  ratingGroups(productIds: readonly string[]): Promise<RatingGroup[]>;
  /** Read both projections from the same snapshot. */
  experienceSnapshot(productIds: readonly string[]): Promise<{
    groups: RatingGroup[];
    summaries: ReviewSummaryEvidence[];
  }>;
}

export interface ReviewExperienceReader {
  getProductStatsBatch(
    productIds: readonly string[],
  ): Promise<Map<string, ReviewStats>>;
  getReviewExperience(
    productIds: readonly string[],
  ): Promise<Map<string, ReviewExperience>>;
}

export const REVIEW_EXPERIENCE_READER = Symbol('REVIEW_EXPERIENCE_READER');
export const REVIEW_EVIDENCE_LOOKUP = Symbol('REVIEW_EVIDENCE_LOOKUP');

export interface ReviewIndexJobs extends ReviewStoreBinding {
  indexDue(now: Date): Promise<string[]>;
  claimIndex(
    id: string,
    token: string,
    now: Date,
    until: Date,
  ): Promise<boolean>;
  renewIndex(id: string, token: string, until: Date): Promise<void>;
  indexLeaseValid(id: string, token: string, now: Date): Promise<boolean>;
  indexAttempt(id: string, token: string): Promise<number | null>;
  finishIndex(id: string, token: string): Promise<void>;
  retryIndex(id: string, token: string, next: Date): Promise<void>;
  requestIndexCleanup(id: string, next: Date): Promise<void>;
}

export type SummaryState = {
  leaseToken: string | null;
  corpusVersion: number;
  requestedVersion: number;
  lastRetractionVersion: number;
  sourceHash: string | null;
  analyzerVersion: string | null;
  positiveImpressions: string[];
  negativeImpressions: string[];
  summary: string | null;
};

export type SummaryWrite = SummaryImpressions & {
  generatedAt: Date;
  sourceReviewCount: number;
  sourceAuthorCount: number;
  sourceVersion: number;
  sourceHash: string;
  analyzerVersion: string;
  nextAttemptAt: Date | null;
};

export interface ReviewSummaryJobs extends ReviewStoreBinding {
  summaryDue(now: Date): Promise<string | null>;
  claimSummary(
    id: string,
    token: string,
    now: Date,
    until: Date,
  ): Promise<boolean>;
  renewSummary(
    id: string,
    token: string,
    now: Date,
    until: Date,
  ): Promise<boolean>;
  summaryAttempt(id: string, token: string): Promise<number | null>;
  retrySummary(
    id: string,
    token: string,
    errorCode: string,
    next: Date,
    exhausted: boolean,
  ): Promise<void>;
  summarySnapshot(
    id: string,
  ): Promise<{ state: SummaryState | null; rows: PublishedReview[] }>;
  clearSummary(id: string, token: string): Promise<void>;
  summaryState(id: string): Promise<SummaryState | null>;
  saveSummary(
    id: string,
    token: string,
    now: Date,
    requestedVersion: number,
    result: SummaryWrite,
  ): Promise<boolean>;
}

export interface ReviewEmbeddings {
  space(): { dimensions: number; version: string };
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
  embedDocument(text: string, signal: AbortSignal): Promise<number[]>;
}

export interface ReviewVectorIndex extends ReviewStoreBinding {
  initialize(dimensions: number): Promise<void>;
  validate(dimensions: number): Promise<void>;
  search(
    productId: string,
    query: string,
    vector: number[],
    space: string,
  ): Promise<ReviewSourceRef[]>;
  versions(
    ids: string[],
  ): Promise<Map<string, { hash: unknown; space: unknown }>>;
  save(
    source: ReviewSource,
    vector: number[],
    space: string,
    hash: string,
  ): Promise<void>;
  listByReview(
    id: string,
    offset?: string | number,
  ): Promise<{ ids: string[]; next?: string | number }>;
  remove(ids: string[]): Promise<void>;
}

export type ReviewModelMessage = { role: 'system' | 'user'; content: string };
export interface ReviewTextModels {
  open(
    task: 'review_summary' | 'product_review_answer',
    schema: ZodType,
    metadata?: Record<string, string>,
  ): {
    countTokens(text: string): Promise<number>;
    invoke(
      messages: ReviewModelMessage[],
      signal?: AbortSignal,
    ): Promise<unknown>;
  };
}

export interface ReviewEvidenceLookup {
  search(
    productId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<ReviewSource[]>;
  resolveSources(
    productId: string,
    refs: readonly ReviewSourceRef[],
  ): Promise<ReviewSource[]>;
}
