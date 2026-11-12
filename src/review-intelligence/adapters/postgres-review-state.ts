import { isUUID } from 'class-validator';
import type {
  ReviewFeed,
  ReviewPublicationChange,
} from '../application/review-feed';
import type {
  ReviewExperiencePort,
  ReviewIndexJobs,
  ReviewSummaryJobs,
  SummaryState,
  SummaryWrite,
} from '../application/ports';
import type { RatingGroup, ReviewSummaryEvidence } from '../core/review-model';
import {
  REVIEW_MAX_ATTEMPTS,
  reviewSummaryAfterChange,
} from '../core/review-policy';

interface Queryable {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}
export interface ReviewPgPool extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

type PersistedSummary = Omit<SummaryState, 'leaseToken'> & {
  sourceVersion: number;
  sourceReviewCount: number;
  sourceAuthorCount: number;
  generatedAt?: string | null;
  lastErrorCode?: string | null;
};
type SchedulePatch = Partial<PersistedSummary> & {
  nextAttemptAt?: Date | null;
  attemptCount?: number;
  leaseToken?: null;
  leaseUntil?: null;
};
const emptySummary: PersistedSummary = {
  corpusVersion: 0,
  sourceVersion: 0,
  requestedVersion: 0,
  lastRetractionVersion: 0,
  sourceReviewCount: 0,
  sourceAuthorCount: 0,
  sourceHash: null,
  analyzerVersion: null,
  summary: null,
  positiveImpressions: [],
  negativeImpressions: [],
};
type SummaryRow = {
  productId: string;
  state: PersistedSummary;
  dueAt: Date | null;
  leaseToken: string | null;
};
type PublicationRow = {
  productId: string;
  publicationId: string;
  revision: string;
  rating: number | null;
  corpusVersion: number;
};
const summaryColumns =
  'product_id AS "productId", state, due_at AS "dueAt", lease_token AS "leaseToken"';
const due = 'attempts < $3 AND (lease_until IS NULL OR lease_until <= $2)';

export class PostgresReviewState
  implements ReviewIndexJobs, ReviewSummaryJobs, ReviewExperiencePort
{
  readonly storeId: string;

  constructor(
    private readonly pool: ReviewPgPool,
    private readonly feed: ReviewFeed,
  ) {
    if (
      !/^[a-zA-Z0-9_.-]{1,120}$/.test(feed.storeId) ||
      feed.storeId === 'nextshop'
    )
      throw new Error('INVALID_PORTABLE_REVIEW_STORE');
    this.storeId = feed.storeId;
  }

  private async transaction<T>(
    begin: string,
    run: (db: Queryable) => Promise<T>,
  ) {
    const db = await this.pool.connect();
    try {
      await db.query(begin);
      const result = await run(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async cursor(db: Queryable = this.pool, lock = false): Promise<number> {
    const { rows } = await db.query<{ position: string }>(
      'SELECT position FROM review_engine.cursor WHERE store_id=$1' +
        (lock ? ' FOR UPDATE' : ''),
      [this.storeId],
    );
    const position = Number(rows[0]?.position ?? 0);
    if (!Number.isSafeInteger(position) || position < 0)
      throw new Error('INVALID_REVIEW_FEED_CURSOR');
    return position;
  }

  async synchronize(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('INVALID_REVIEW_FEED_LIMIT');
    const position = await this.cursor();
    const batch = await this.feed.changesAfter(position, limit);
    if (
      batch.length > limit ||
      batch.some(
        (event, index) =>
          event.position !== position + index + 1 ||
          !Number.isSafeInteger(event.position) ||
          !Number.isSafeInteger(event.revision) ||
          event.revision < 1 ||
          !isUUID(event.reviewId) ||
          !isUUID(event.productId) ||
          !isUUID(event.publicationId) ||
          (event.rating !== null &&
            (!Number.isInteger(event.rating) ||
              event.rating < 1 ||
              event.rating > 5)),
      )
    )
      throw new Error('INVALID_REVIEW_FEED_BATCH');
    if (!batch.length) return { position, applied: 0 };
    return this.transaction('BEGIN', async (db) => {
      await db.query(
        'INSERT INTO review_engine.cursor (store_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [this.storeId],
      );
      const current = await this.cursor(db, true);
      if (current !== position) return { position: current, applied: 0 };
      let applied = 0;
      for (const event of batch) if (await this.apply(db, event)) applied++;
      const next = batch[batch.length - 1].position;
      await db.query(
        'UPDATE review_engine.cursor SET position=$2 WHERE store_id=$1',
        [this.storeId, next],
      );
      return { position: next, applied };
    });
  }

  private async apply(db: Queryable, event: ReviewPublicationChange) {
    const {
      rows: [previous],
    } = await db.query<PublicationRow>(
      `SELECT product_id AS "productId", publication_id AS "publicationId",
         revision, rating, corpus_version AS "corpusVersion"
       FROM review_engine.publication WHERE store_id=$1 AND review_id=$2`,
      [this.storeId, event.reviewId],
    );
    if (previous && event.revision <= Number(previous.revision)) return false;
    if (
      previous &&
      (previous.productId !== event.productId ||
        (previous.publicationId === event.publicationId &&
          event.rating !== null))
    )
      throw new Error('INVALID_REVIEW_PUBLICATION_REVISION');
    const wasPublic = previous != null && previous.rating !== null;
    const changed = wasPublic || event.rating !== null;
    let corpusVersion = previous?.corpusVersion ?? 0;
    if (changed) {
      await db.query(
        'INSERT INTO review_engine.summary (store_id,product_id,state) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [this.storeId, event.productId, emptySummary],
      );
      const {
        rows: [summary],
      } = await db.query<SummaryRow>(
        `SELECT ${summaryColumns} FROM review_engine.summary WHERE store_id=$1 AND product_id=$2 FOR UPDATE`,
        [this.storeId, event.productId],
      );
      corpusVersion = summary.state.corpusVersion + 1;
      const {
        rows: [current],
      } = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM review_engine.publication
         WHERE store_id=$1 AND product_id=$2 AND rating IS NOT NULL AND review_id<>$3`,
        [this.storeId, event.productId, event.reviewId],
      );
      const policy = reviewSummaryAfterChange(
        { ...summary.state, corpusVersion, nextAttemptAt: summary.dueAt },
        wasPublic ? 'delete' : 'review',
        previous?.corpusVersion ?? null,
        current.count + Number(event.rating !== null),
        new Date(),
      );
      const patch: SchedulePatch = policy ?? {};
      const {
        nextAttemptAt,
        attemptCount,
        leaseToken,
        leaseUntil,
        ...statePatch
      } = patch;
      await db.query(
        `UPDATE review_engine.summary SET state=state || $3::jsonb,
          due_at=CASE WHEN $4 THEN $5 ELSE due_at END,
          attempts=COALESCE($6,attempts),
          lease_token=CASE WHEN $7 THEN NULL ELSE lease_token END,
          lease_until=CASE WHEN $7 THEN NULL ELSE lease_until END
         WHERE store_id=$1 AND product_id=$2`,
        [
          this.storeId,
          event.productId,
          { ...statePatch, corpusVersion },
          nextAttemptAt !== undefined,
          nextAttemptAt ?? null,
          attemptCount ?? null,
          leaseToken === null,
        ],
      );
    }
    await db.query(
      `INSERT INTO review_engine.publication
        (store_id,review_id,product_id,publication_id,revision,rating,corpus_version,pending)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (store_id,review_id) DO UPDATE SET
        publication_id=excluded.publication_id, revision=excluded.revision,
        rating=excluded.rating, corpus_version=excluded.corpus_version,
        pending=excluded.pending OR review_engine.publication.pending,
        due_at=CASE WHEN excluded.pending THEN NULL ELSE review_engine.publication.due_at END,
        lease_token=CASE WHEN excluded.pending THEN NULL ELSE review_engine.publication.lease_token END,
        lease_until=CASE WHEN excluded.pending THEN NULL ELSE review_engine.publication.lease_until END,
        attempts=CASE WHEN excluded.pending THEN 0 ELSE review_engine.publication.attempts END`,
      [
        this.storeId,
        event.reviewId,
        event.productId,
        event.publicationId,
        event.revision,
        event.rating,
        corpusVersion,
        changed,
      ],
    );
    return true;
  }

  private async current(position: number) {
    return position === (await this.feed.head());
  }

  async ratingGroups(productIds: readonly string[]) {
    return (await this.experienceSnapshot(productIds)).groups;
  }

  async experienceSnapshot(productIds: readonly string[]) {
    const snapshot = await this.transaction(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      async (db) => {
        const position = await this.cursor(db);
        const { rows: groups } = await db.query<RatingGroup>(
          `SELECT product_id AS "productId", rating, count(*)::int AS count
         FROM review_engine.publication WHERE store_id=$1 AND product_id=ANY($2::uuid[])
           AND rating IS NOT NULL GROUP BY product_id,rating`,
          [this.storeId, productIds],
        );
        const { rows } = await db.query<SummaryRow>(
          `SELECT ${summaryColumns} FROM review_engine.summary WHERE store_id=$1 AND product_id=ANY($2::uuid[])`,
          [this.storeId, productIds],
        );
        const summaries = rows.flatMap(
          ({ productId, state }): ReviewSummaryEvidence[] =>
            state.summary !== null &&
            state.generatedAt &&
            state.sourceReviewCount >= 10 &&
            state.sourceAuthorCount >= 10
              ? [
                  {
                    productId,
                    summary: state.summary,
                    generatedAt: state.generatedAt,
                    sourceReviewCount: state.sourceReviewCount,
                    sourceVersion: state.sourceVersion,
                    lastRetractionVersion: state.lastRetractionVersion,
                    positiveImpressions: state.positiveImpressions,
                    negativeImpressions: state.negativeImpressions,
                  },
                ]
              : [],
        );
        return { position, groups, summaries };
      },
    );
    return (await this.current(snapshot.position))
      ? { groups: snapshot.groups, summaries: snapshot.summaries }
      : { groups: [], summaries: [] };
  }

  async indexDue(now: Date) {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT review_id AS id FROM review_engine.publication WHERE store_id=$1 AND pending
       AND (due_at IS NULL OR due_at <= $2) AND ${due} ORDER BY due_at NULLS LAST,review_id LIMIT 5`,
      [this.storeId, now, REVIEW_MAX_ATTEMPTS],
    );
    return rows.map(({ id }) => id);
  }

  async claimIndex(id: string, token: string, now: Date, until: Date) {
    const { rowCount } = await this.pool.query(
      `UPDATE review_engine.publication SET lease_token=$5,lease_until=$6,attempts=attempts+1
       WHERE store_id=$1 AND review_id=$4 AND pending AND (due_at IS NULL OR due_at <= $2) AND ${due}`,
      [this.storeId, now, REVIEW_MAX_ATTEMPTS, id, token, until],
    );
    return rowCount === 1;
  }

  async renewIndex(id: string, token: string, until: Date) {
    await this.pool.query(
      'UPDATE review_engine.publication SET lease_until=$4 WHERE store_id=$1 AND review_id=$2 AND lease_token=$3',
      [this.storeId, id, token, until],
    );
  }

  async indexLeaseValid(id: string, token: string, now: Date) {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM review_engine.publication WHERE store_id=$1 AND review_id=$2 AND lease_token=$3 AND lease_until > $4',
      [this.storeId, id, token, now],
    );
    return rowCount === 1;
  }

  async indexAttempt(id: string, token: string) {
    const { rows } = await this.pool.query<{ attempts: number }>(
      'SELECT attempts FROM review_engine.publication WHERE store_id=$1 AND review_id=$2 AND lease_token=$3',
      [this.storeId, id, token],
    );
    return rows[0]?.attempts ?? null;
  }

  async finishIndex(id: string, token: string) {
    await this.pool.query(
      `UPDATE review_engine.publication SET pending=false,due_at=NULL,lease_token=NULL,lease_until=NULL,attempts=0
       WHERE store_id=$1 AND review_id=$2 AND lease_token=$3`,
      [this.storeId, id, token],
    );
  }

  async retryIndex(id: string, token: string, next: Date) {
    await this.pool.query(
      `UPDATE review_engine.publication SET due_at=$4,lease_token=NULL,lease_until=NULL
       WHERE store_id=$1 AND review_id=$2 AND lease_token=$3`,
      [this.storeId, id, token, next],
    );
  }

  async requestIndexCleanup(id: string, next: Date) {
    await this.pool.query(
      `UPDATE review_engine.publication SET pending=true,due_at=$3,lease_token=NULL,lease_until=NULL
       WHERE store_id=$1 AND review_id=$2`,
      [this.storeId, id, next],
    );
  }

  async summaryDue(now: Date) {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT product_id AS id FROM review_engine.summary WHERE store_id=$1 AND due_at <= $2
       AND ${due} ORDER BY due_at,product_id LIMIT 1`,
      [this.storeId, now, REVIEW_MAX_ATTEMPTS],
    );
    return rows[0]?.id ?? null;
  }

  async claimSummary(id: string, token: string, now: Date, until: Date) {
    const { rowCount } = await this.pool.query(
      `UPDATE review_engine.summary SET lease_token=$5,lease_until=$6,attempts=attempts+1
       WHERE store_id=$1 AND product_id=$4 AND due_at <= $2 AND ${due}`,
      [this.storeId, now, REVIEW_MAX_ATTEMPTS, id, token, until],
    );
    return rowCount === 1;
  }

  async renewSummary(id: string, token: string, now: Date, until: Date) {
    const { rowCount } = await this.pool.query(
      `UPDATE review_engine.summary SET lease_until=$5 WHERE store_id=$1 AND product_id=$2
       AND lease_token=$3 AND lease_until > $4`,
      [this.storeId, id, token, now, until],
    );
    return rowCount === 1;
  }

  async summaryAttempt(id: string, token: string) {
    const { rows } = await this.pool.query<{ attempts: number }>(
      `SELECT attempts FROM review_engine.summary WHERE store_id=$1 AND product_id=$2
       AND lease_token=$3 AND due_at IS NOT NULL`,
      [this.storeId, id, token],
    );
    return rows[0]?.attempts ?? null;
  }

  async retrySummary(
    id: string,
    token: string,
    errorCode: string,
    next: Date,
    exhausted: boolean,
  ) {
    await this.pool.query(
      `UPDATE review_engine.summary SET lease_token=NULL,lease_until=NULL,due_at=$4,
       state=state || $5::jsonb,attempts=COALESCE($6,attempts)
       WHERE store_id=$1 AND product_id=$2 AND lease_token=$3 AND due_at IS NOT NULL`,
      [
        this.storeId,
        id,
        token,
        next,
        { lastErrorCode: errorCode },
        exhausted ? REVIEW_MAX_ATTEMPTS : null,
      ],
    );
  }

  async summaryState(id: string, db: Queryable = this.pool) {
    const {
      rows: [row],
    } = await db.query<SummaryRow>(
      `SELECT ${summaryColumns} FROM review_engine.summary WHERE store_id=$1 AND product_id=$2`,
      [this.storeId, id],
    );
    return row ? { ...row.state, leaseToken: row.leaseToken } : null;
  }

  async summarySnapshot(id: string) {
    const snapshot = await this.transaction(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      async (db) => {
        const position = await this.cursor(db);
        const state = await this.summaryState(id, db);
        const { rows: refs } = await db.query<{
          id: string;
          publicationId: string;
        }>(
          `SELECT review_id AS id, publication_id AS "publicationId" FROM review_engine.publication
         WHERE store_id=$1 AND product_id=$2 AND rating IS NOT NULL`,
          [this.storeId, id],
        );
        return { position, state, refs };
      },
    );
    const refs = new Map(
      snapshot.refs.map((ref) => [ref.id, ref.publicationId]),
    );
    const found = refs.size
      ? await this.feed.listPublished([...refs.keys()], id)
      : [];
    const rows = new Map(
      found
        .filter(
          (row) =>
            row.productId === id && refs.get(row.id) === row.publicationId,
        )
        .map((row) => [row.id, row]),
    );
    if (rows.size !== refs.size || !(await this.current(snapshot.position)))
      throw new Error('REVIEW_SUMMARY_SOURCE_CHANGED');
    return {
      state: snapshot.state,
      rows: [...rows.values()].sort(
        (a, b) =>
          a.publishedAt.getTime() - b.publishedAt.getTime() ||
          a.id.localeCompare(b.id),
      ),
    };
  }

  async clearSummary(id: string, token: string) {
    await this.pool.query(
      `UPDATE review_engine.summary SET due_at=NULL,lease_token=NULL,lease_until=NULL,state=state || $4::jsonb
       WHERE store_id=$1 AND product_id=$2 AND lease_token=$3`,
      [
        this.storeId,
        id,
        token,
        {
          summary: null,
          generatedAt: null,
          positiveImpressions: [],
          negativeImpressions: [],
          lastErrorCode: null,
        },
      ],
    );
  }

  async saveSummary(
    id: string,
    token: string,
    now: Date,
    requestedVersion: number,
    result: SummaryWrite,
  ) {
    if (!(await this.current(await this.cursor()))) return false;
    const { nextAttemptAt, ...state } = result;
    const { rowCount } = await this.pool.query(
      `UPDATE review_engine.summary SET due_at=$7,lease_token=NULL,lease_until=NULL,attempts=0,state=state || $8::jsonb
       WHERE store_id=$1 AND product_id=$2 AND lease_token=$3 AND lease_until > $4
         AND (state->>'requestedVersion')::int=$5 AND (state->>'lastRetractionVersion')::int <= $6`,
      [
        this.storeId,
        id,
        token,
        now,
        requestedVersion,
        result.sourceVersion,
        nextAttemptAt,
        { ...state, lastErrorCode: null },
      ],
    );
    return rowCount === 1;
  }
}
