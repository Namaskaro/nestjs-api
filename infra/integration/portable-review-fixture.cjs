const { createHash } = require('node:crypto');

function uuid(value) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(
    13,
    16,
  )}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const productId = uuid('portable-fixture/SKU-WALK');
const fixtureSql = `
  CREATE SCHEMA IF NOT EXISTS review_source_fixture;
  CREATE TABLE IF NOT EXISTS review_source_fixture.stream (
    store_id text PRIMARY KEY, head bigint NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS review_source_fixture.events (
    store_id text NOT NULL, position bigint NOT NULL, review_id uuid NOT NULL,
    revision bigint NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (store_id, position)
  );
`;

function ticket(n, edition = 1, stars = 5, tenant = 'A') {
  return {
    key: `case-${n}`,
    edition,
    sku: 'SKU-WALK',
    visibility: stars === null ? 'withdrawn' : 'published',
    customer: `author-${n}`,
    date: '2026-01-01T00:00:00.000Z',
    content: {
      stars,
      body: `Walk comfort from store ${tenant}, source ${n}, edition ${edition}.`,
    },
  };
}

const reviewId = (entry) => uuid(entry.key);
const publicationId = (entry) => uuid(`${entry.key}/${entry.edition}`);
const ref = (entry) => ({
  reviewId: reviewId(entry),
  publicationId: publicationId(entry),
  sourceId: publicationId(entry),
});

class PostgresFixtureFeed {
  constructor(pool, storeId) {
    this.pool = pool;
    this.storeId = storeId;
  }

  // Simulates a store writing its own independent, durable feed.
  async append(entry, revision = entry.edition) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'INSERT INTO review_source_fixture.stream (store_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [this.storeId],
      );
      const {
        rows: [{ head }],
      } = await db.query(
        'UPDATE review_source_fixture.stream SET head=head+1 WHERE store_id=$1 RETURNING head',
        [this.storeId],
      );
      await db.query(
        'INSERT INTO review_source_fixture.events (store_id,position,review_id,revision,payload) VALUES ($1,$2,$3,$4,$5)',
        [this.storeId, head, reviewId(entry), revision, entry],
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async head() {
    const { rows } = await this.pool.query(
      'SELECT head FROM review_source_fixture.stream WHERE store_id=$1',
      [this.storeId],
    );
    return Number(rows[0]?.head ?? 0);
  }

  async changesAfter(position, limit) {
    const { rows } = await this.pool.query(
      'SELECT position,revision,payload FROM review_source_fixture.events WHERE store_id=$1 AND position>$2 ORDER BY position LIMIT $3',
      [this.storeId, position, limit],
    );
    return rows.map(({ position, revision, payload }) => ({
      position: Number(position),
      revision: Number(revision),
      reviewId: reviewId(payload),
      publicationId: publicationId(payload),
      productId,
      rating: payload.visibility === 'published' ? payload.content.stars : null,
    }));
  }

  async productExists(id) {
    return id === productId;
  }

  async latest(ids = null) {
    const { rows } = await this.pool.query(
      `SELECT payload FROM (
         SELECT DISTINCT ON (review_id) review_id,payload FROM review_source_fixture.events
         WHERE store_id=$1 AND ($2::uuid[] IS NULL OR review_id=ANY($2::uuid[]))
         ORDER BY review_id,revision DESC,position DESC
       ) latest WHERE payload->>'visibility'='published'`,
      [this.storeId, ids],
    );
    return rows.map(({ payload }) => ({
      id: reviewId(payload),
      publicationId: publicationId(payload),
      productId,
      rating: payload.content.stars,
      text: payload.content.body,
      publishedAt: new Date(payload.date),
      author: { id: payload.customer, name: payload.customer, image: null },
      addenda: [],
    }));
  }

  async hasPublished(id) {
    return id === productId && (await this.latest()).length > 0;
  }

  async listPublished(ids, id) {
    return ids.length && (!id || id === productId) ? this.latest(ids) : [];
  }
}

function deterministicModels() {
  const vector = Array.from({ length: 768 }, (_, index) => Number(index === 0));
  return {
    space: () => ({
      dimensions: vector.length,
      version: 'portable-fixture-v1',
    }),
    embedDocument: async () => vector,
    embedQuery: async () => vector,
    open: (task) => ({
      countTokens: async (text) => Math.ceil(text.length / 4),
      invoke: async () =>
        task === 'review_summary'
          ? {
              summary: 'Покупатели описывают удобство на прогулке.',
              positiveImpressions: ['Удобство'],
              negativeImpressions: [],
            }
          : {
              message: 'В отзывах есть опыт комфортных прогулок.',
              usedPositions: [1],
            },
    }),
  };
}

module.exports = {
  PostgresFixtureFeed,
  fixtureSql,
  productId,
  ticket,
  ref,
  uuid,
  deterministicModels,
};
