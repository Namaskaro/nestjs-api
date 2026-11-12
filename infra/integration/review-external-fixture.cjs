const { createHash } = require('node:crypto');
const {
  reviewSummaryAfterChange,
} = require('@/src/review-intelligence/core/review-policy');

function key(value) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(
    13,
    16,
  )}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Simulates an authoritative external feed with SKU, ticket, and account keys.
// Identical external keys are intentionally allowed in different stores.
class ExternalReviewSource {
  records = new Map();

  constructor(storeId, productsBySku) {
    this.storeId = storeId;
    this.productsBySku = productsBySku;
  }

  normalize(entry) {
    if (!entry || entry.visibility !== 'live') return null;
    return {
      id: key(entry.ticket),
      publicationId: key(`${entry.ticket}:${entry.edition}`),
      productId: this.productsBySku.get(entry.sku),
      text: entry.body.comment,
      rating: entry.body.stars,
      publishedAt: new Date(entry.visibleSince),
      author: { id: entry.account.key, name: entry.account.label, image: null },
      addenda: [],
    };
  }

  put(entry) {
    const old = this.records.get(entry.ticket);
    if (old && old.change >= entry.change) return null;
    if (!this.productsBySku.has(entry.sku) || (old && old.sku !== entry.sku))
      throw new Error('Unsupported SKU');
    this.records.set(entry.ticket, entry);
    return { previous: this.normalize(old), next: this.normalize(entry) };
  }

  published(productId) {
    return [...this.records.values()]
      .map((entry) => this.normalize(entry))
      .filter(
        (review) => review && (!productId || productId === review.productId),
      );
  }

  async productExists(productId) {
    return [...this.productsBySku.values()].includes(productId);
  }

  async hasPublished(productId) {
    return this.published(productId).length > 0;
  }

  async listPublished(ids, productId) {
    return this.published(productId).filter(({ id }) => ids.includes(id));
  }
}

// Test persistence for the independent feed. Production durable jobs exercise
// the same application operations through Prisma in reviews.test.cjs.
class ExternalReviewState {
  #index = new Map();
  #summaries = new Map();
  #versions = new Map();

  constructor(source) {
    this.source = source;
    this.storeId = source.storeId;
  }

  ingest(entry) {
    const change = this.source.put(entry);
    if (!change || (!change.previous && !change.next)) return;
    const { previous, next } = change;
    const review = next ?? previous;
    const id = review.productId;
    this.#index.set(review.id, {
      token: null,
      until: null,
      attempts: 0,
      due: new Date(0),
    });
    const state = this.#summaries.get(id) ?? {
      corpusVersion: 0,
      sourceVersion: 0,
      requestedVersion: 0,
      lastRetractionVersion: 0,
      sourceReviewCount: 0,
      sourceHash: null,
      analyzerVersion: null,
      summary: null,
      nextAttemptAt: null,
      positiveImpressions: [],
      negativeImpressions: [],
      leaseToken: null,
      leaseUntil: null,
      attemptCount: 0,
    };
    state.corpusVersion++;
    const priorVersion = previous
      ? this.#versions.get(previous.publicationId) ?? null
      : null;
    Object.assign(
      state,
      reviewSummaryAfterChange(
        state,
        previous ? 'delete' : 'review',
        priorVersion,
        this.source.published(id).length,
        new Date(),
      ),
    );
    if (next) this.#versions.set(next.publicationId, state.corpusVersion);
    this.#summaries.set(id, state);
  }

  makeSummaryDue(id) {
    const row = this.#summaries.get(id);
    if (row?.nextAttemptAt) row.nextAttemptAt = new Date(0);
  }

  async ratingGroups(ids) {
    return this.source
      .published()
      .filter(({ productId }) => ids.includes(productId))
      .map(({ productId, rating }) => ({ productId, rating, count: 1 }));
  }

  async experienceSnapshot(ids) {
    const summaries = ids.flatMap((productId) => {
      const row = this.#summaries.get(productId);
      if (!row?.summary || !row.generatedAt) return [];
      const {
        summary,
        positiveImpressions,
        negativeImpressions,
        generatedAt,
        sourceReviewCount,
        sourceVersion,
        lastRetractionVersion,
      } = row;
      return [
        {
          productId,
          summary,
          positiveImpressions,
          negativeImpressions,
          generatedAt: generatedAt.toISOString(),
          sourceReviewCount,
          sourceVersion,
          lastRetractionVersion,
        },
      ];
    });
    return { groups: await this.ratingGroups(ids), summaries };
  }

  async indexDue(now) {
    return [...this.#index]
      .filter(
        ([, row]) =>
          row.attempts < 5 &&
          row.due <= now &&
          (!row.until || row.until <= now),
      )
      .map(([id]) => id)
      .slice(0, 5);
  }

  async claimIndex(id, token, now, until) {
    const row = this.#index.get(id);
    if (!row || row.due > now || row.attempts >= 5 || row.until > now)
      return false;
    Object.assign(row, { token, until, attempts: row.attempts + 1 });
    return true;
  }

  async renewIndex(id, token, until) {
    const row = this.#index.get(id);
    if (row?.token === token) row.until = until;
  }

  async indexLeaseValid(id, token, now) {
    const row = this.#index.get(id);
    return row?.token === token && row.until > now;
  }

  async indexAttempt(id, token) {
    const row = this.#index.get(id);
    return row?.token === token ? row.attempts : null;
  }

  async finishIndex(id, token) {
    if (this.#index.get(id)?.token === token) this.#index.delete(id);
  }

  async retryIndex(id, token, due) {
    const row = this.#index.get(id);
    if (row?.token === token)
      Object.assign(row, { token: null, until: null, due });
  }

  async requestIndexCleanup(id, due) {
    this.#index.set(id, {
      token: null,
      until: null,
      attempts: this.#index.get(id)?.attempts ?? 0,
      due,
    });
  }

  async summaryDue(now) {
    return (
      [...this.#summaries].find(([, row]) =>
        this.summaryIsDue(row, now),
      )?.[0] ?? null
    );
  }

  summaryIsDue(row, now) {
    return !!(
      row?.nextAttemptAt &&
      row.nextAttemptAt <= now &&
      row.attemptCount < 5 &&
      (!row.leaseUntil || row.leaseUntil <= now)
    );
  }

  async claimSummary(id, leaseToken, now, leaseUntil) {
    const row = this.#summaries.get(id);
    if (!this.summaryIsDue(row, now)) return false;
    Object.assign(row, {
      leaseToken,
      leaseUntil,
      attemptCount: row.attemptCount + 1,
    });
    return true;
  }

  async renewSummary(id, leaseToken, now, leaseUntil) {
    const row = this.#summaries.get(id);
    if (row?.leaseToken !== leaseToken || row.leaseUntil <= now) return false;
    row.leaseUntil = leaseUntil;
    return true;
  }

  async summaryAttempt(id, token) {
    const row = this.#summaries.get(id);
    return row?.leaseToken === token && row.nextAttemptAt
      ? row.attemptCount
      : null;
  }

  async retrySummary(id, token, lastErrorCode, nextAttemptAt, exhausted) {
    const row = this.#summaries.get(id);
    if (row?.leaseToken !== token || !row.nextAttemptAt) return;
    Object.assign(row, {
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode,
      nextAttemptAt,
      ...(exhausted ? { attemptCount: 5 } : {}),
    });
  }

  async summarySnapshot(id) {
    return {
      state: await this.summaryState(id),
      rows: this.source.published(id),
    };
  }

  async summaryState(id) {
    const row = this.#summaries.get(id);
    return row ? { ...row } : null;
  }

  async clearSummary(id, token) {
    const row = this.#summaries.get(id);
    if (row?.leaseToken !== token) return;
    Object.assign(row, {
      summary: null,
      generatedAt: null,
      positiveImpressions: [],
      negativeImpressions: [],
      nextAttemptAt: null,
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: null,
    });
  }

  async saveSummary(id, token, now, requestedVersion, result) {
    const row = this.#summaries.get(id);
    if (
      row?.leaseToken !== token ||
      row.leaseUntil <= now ||
      row.requestedVersion !== requestedVersion ||
      row.lastRetractionVersion > result.sourceVersion
    )
      return false;
    Object.assign(row, result, {
      attemptCount: 0,
      lastErrorCode: null,
      leaseToken: null,
      leaseUntil: null,
    });
    return true;
  }
}

module.exports = { ExternalReviewSource, ExternalReviewState };
