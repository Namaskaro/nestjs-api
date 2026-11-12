export const REVIEW_LEASE_MS = 120_000;
export const REVIEW_MAX_ATTEMPTS = 5;
export const REVIEW_COALESCE_MS = 30_000;

export function reviewRetryDelay(attempt: number) {
  return [30_000, 120_000, 600_000, 3_600_000][
    Math.min(Math.max(attempt - 1, 0), 3)
  ];
}

export function nextReviewSummaryCount(processed: number): number {
  if (processed < 10) return 10;
  return processed < 100
    ? (Math.floor(processed / 10) + 1) * 10
    : processed + Math.ceil(processed * 0.1);
}

export function isReviewSummaryMilestone(
  processed: number,
  count: number,
): boolean {
  for (
    let threshold = nextReviewSummaryCount(processed);
    threshold <= count;
    threshold = nextReviewSummaryCount(threshold)
  ) {
    if (count === threshold) return true;
  }
  return false;
}

/** Apply in the same transaction as the new authoritative publication revision. */
export function reviewSummaryAfterChange(
  state: {
    corpusVersion: number;
    sourceVersion: number;
    sourceReviewCount: number;
    summary: string | null;
    nextAttemptAt: Date | null;
  },
  kind: 'review' | 'delete',
  publishedCorpusVersion: number | null,
  count: number,
  now: Date,
) {
  const scheduled = new Date(now.getTime() + REVIEW_COALESCE_MS);
  const due =
    state.nextAttemptAt && state.nextAttemptAt < scheduled
      ? state.nextAttemptAt
      : scheduled;
  const request = {
    requestedVersion: state.corpusVersion,
    nextAttemptAt: due,
    attemptCount: 0,
    lastErrorCode: null,
  };
  if (kind === 'review') {
    const base = state.summary === null ? 0 : state.sourceReviewCount;
    return count >= nextReviewSummaryCount(base) &&
      (!state.nextAttemptAt || isReviewSummaryMilestone(base, count))
      ? request
      : null;
  }
  const included =
    state.summary !== null &&
    (publishedCorpusVersion === null ||
      publishedCorpusVersion <= state.sourceVersion);
  const invalidate = included || count < 10;
  const requested = count >= 10 && (included || state.nextAttemptAt !== null);
  return {
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
    ...(requested ? request : {}),
    ...(count < 10 ? { nextAttemptAt: null } : {}),
    leaseToken: null,
    leaseUntil: null,
  };
}
