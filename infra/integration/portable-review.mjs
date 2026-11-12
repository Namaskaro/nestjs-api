import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { lifecycle, withServices } from './environment.mjs';

const require = createRequire(import.meta.url);
const [phase, run] = process.argv.slice(2);
const filename = fileURLToPath(import.meta.url);

function child(step, id) {
  const result = spawnSync(process.execPath, [filename, step, id], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Portable host ${step} failed`);
}

async function ensureIndependentDatabase(pool) {
  const {
    rows: [row],
  } = await pool.query(`SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public'
  ) AS clean`);
  assert.ok(
    row.clean,
    'Use the isolated Shared Integration Environment before Prisma migrations',
  );
}

async function exercise(
  step,
  id,
  { pool, qdrantUrl, qdrantApiKey, qdrant: httpQdrant },
) {
  await ensureIndependentDatabase(pool);
  require('reflect-metadata');
  require('ts-node/register/transpile-only');
  require('tsconfig-paths/register');
  const { QdrantClient } = await import('@qdrant/js-client-rest');
  const { QdrantService } = require('@/src/core/qdrant/qdrant.service');
  const {
    QdrantReviewIndex,
  } = require('@/src/review-intelligence/adapters/qdrant-review-index');
  const {
    PostgresReviewState,
  } = require('@/src/review-intelligence/adapters/postgres-review-state');
  const {
    createPortableReviewRuntime,
  } = require('@/src/review-intelligence/portable-runtime');
  const {
    PostgresFixtureFeed,
    fixtureSql,
    productId,
    ticket,
    ref,
    uuid,
    deterministicModels,
  } = require('./portable-review-fixture.cjs');
  const qdrant = new QdrantService(
    new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey,
      checkCompatibility: false,
      timeout: 10_000,
    }),
  );
  if (step === 'stage') {
    const ddl = readFileSync(
      new URL(
        '../../src/review-intelligence/adapters/postgres-review-state.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const db = await pool.connect();
    try {
      await db.query(ddl);
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    await pool.query(fixtureSql);
  }
  const models = deterministicModels();
  const host = (suffix) => {
    const storeId = `portable-it-${id}-${suffix}`;
    const feed = new PostgresFixtureFeed(pool, storeId);
    const runtime = createPortableReviewRuntime({
      postgres: pool,
      qdrant,
      feed,
      text: models,
      embeddings: models,
      summaryLimits: () => ({ inputTokenBudget: 6000, maxCalls: 1 }),
      logger: {
        log() {},
        warn: (event) => console.warn(event.event, event.code ?? ''),
      },
    });
    return {
      storeId,
      feed,
      runtime,
      state: new PostgresReviewState(pool, feed),
      collection: new QdrantReviewIndex(qdrant, storeId).collection,
    };
  };
  const a = host('a');
  const b = host('b');
  const peer = host('a');
  const stats = async (h) =>
    (await h.runtime.experience([productId])).get(productId);
  const scheduleSummary = (h) =>
    pool.query(
      "UPDATE review_engine.summary SET due_at=now()-interval '1 second' WHERE store_id=$1 AND due_at IS NOT NULL",
      [h.storeId],
    );
  const point = (h, entry) =>
    qdrant.retrievePoints(h.collection, [ref(entry).sourceId]);
  const first = ticket(1);
  const second = ticket(2);
  const updated = ticket(1, 2, 4);
  const updatedSecond = ticket(2, 2, 4);
  const indexToken = uuid(`${id}/index`);
  const summaryToken = uuid(`${id}/summary`);
  const anotherToken = uuid(`${id}/other`);
  try {
    if (step === 'stage') {
      await Promise.all(
        Array.from({ length: 9 }, (_, i) => a.feed.append(ticket(i + 1))),
      );
      await a.feed.append({ ...ticket(10), visibility: 'draft' });
      await b.feed.append(ticket(1, 1, 1, 'B'));
      const syncs = await Promise.all([
        a.runtime.synchronize(),
        peer.runtime.synchronize(),
        b.runtime.synchronize(),
      ]);
      assert.equal(syncs[0].applied + syncs[1].applied, 10);
      assert.equal(syncs[2].applied, 1);
      assert.equal(await a.state.cursor(), 10);
      assert.equal((await stats(a)).ratingCount, 9);
      assert.equal((await stats(a)).summary, null);
      await a.feed.append(ticket(10, 2));
      assert.deepEqual(await a.runtime.synchronize(), {
        position: 11,
        applied: 1,
      });
      await Promise.all([a.runtime.initialize(), b.runtime.initialize()]);
      await scheduleSummary(a);
      await Promise.all([
        a.runtime.runPending(),
        peer.runtime.runPending(),
        b.runtime.runPending(),
      ]);
      await a.runtime.runPending(); // Drain the remaining index batch.
      assert.equal((await stats(a)).summary.sourceReviewCount, 10);
      assert.equal((await stats(b)).averageRating, 1);
      assert.equal((await stats(b)).summary, null);
      const { sources } = await a.runtime.answer(productId, 'walk comfort');
      assert.equal(sources.length, 1);
      assert.match(sources[0].text, /store A/);
      assert.match(
        (await b.runtime.search(productId, 'walk comfort'))[0].text,
        /store B/,
      );
      assert.equal((await point(a, first)).length, 1);
      assert.equal((await point(b, first)).length, 1);

      await a.feed.append(updated);
      await a.feed.append(updatedSecond);
      await a.feed.append(first); // Redelivery at a new stream position.
      assert.deepEqual(
        await a.runtime.resolveSources(productId, [ref(first)]),
        [],
      );
      assert.equal((await stats(a)).summary, null); // Projection is behind source head.
      const changes = await Promise.all([
        a.runtime.synchronize(),
        peer.runtime.synchronize(),
      ]);
      assert.equal(changes[0].applied + changes[1].applied, 2);
      assert.equal(await a.state.cursor(), 14);
      assert.equal((await stats(a)).ratingCount, 10);
      assert.equal((await stats(a)).averageRating, 4.8);
      assert.equal((await stats(a)).summary, null);

      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60_000);
      const claims = await Promise.all([
        a.state.claimIndex(ref(first).reviewId, indexToken, now, future),
        peer.state.claimIndex(ref(first).reviewId, anotherToken, now, future),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      assert.equal(
        await a.state.claimIndex(ref(second).reviewId, indexToken, now, future),
        true,
      );
      await a.state.retryIndex(ref(second).reviewId, indexToken, future);
      await scheduleSummary(a);
      const summaryClaims = await Promise.all([
        a.state.claimSummary(productId, summaryToken, new Date(), future),
        peer.state.claimSummary(productId, anotherToken, new Date(), future),
      ]);
      assert.equal(summaryClaims.filter(Boolean).length, 1);
      console.log(
        'PASS independent host: 10/1 reviews, Summary, Q&A, identical tenant IDs, concurrent ingest and leases',
      );
    } else {
      assert.equal(await a.feed.head(), 14);
      assert.equal(await a.state.cursor(), 14);
      assert.equal(await b.state.cursor(), 1);
      assert.equal((await stats(a)).averageRating, 4.8);
      assert.equal((await stats(a)).summary, null);
      assert.equal((await point(a, first)).length, 1); // Stale vector survived the restart.
      assert.deepEqual(
        await a.runtime.resolveSources(productId, [ref(first)]),
        [],
      );
      assert.equal((await point(b, first)).length, 1);
      const {
        rows: [leased, retried],
      } = await pool.query(
        `SELECT review_id,pending,attempts,lease_token,due_at FROM review_engine.publication
         WHERE store_id=$1 AND review_id=ANY($2::uuid[]) ORDER BY lease_token NULLS LAST`,
        [a.storeId, [ref(first).reviewId, ref(second).reviewId]],
      );
      assert.equal(leased.review_id, ref(first).reviewId);
      assert.equal(leased.attempts, 1);
      assert.equal(retried.review_id, ref(second).reviewId);
      assert.equal(retried.attempts, 1);
      assert.equal(retried.lease_token, null);
      assert.ok(retried.due_at > new Date());
      const priorSummary = await a.state.summaryState(productId);
      assert.ok(priorSummary.leaseToken);
      assert.equal(
        await a.state.summaryAttempt(productId, priorSummary.leaseToken),
        1,
      );
      assert.deepEqual(await a.state.indexDue(new Date()), []);
      assert.equal(await a.state.summaryDue(new Date()), null);

      // Advance only the two test timers after proving their persisted values.
      await pool.query(
        "UPDATE review_engine.publication SET due_at=now()-interval '1 second',lease_until=now()-interval '1 second' WHERE store_id=$1 AND pending",
        [a.storeId],
      );
      await pool.query(
        "UPDATE review_engine.summary SET lease_until=now()-interval '1 second' WHERE store_id=$1",
        [a.storeId],
      );
      await Promise.all([a.runtime.runPending(), peer.runtime.runPending()]);
      assert.equal((await point(a, first)).length, 0);
      assert.equal((await point(a, updated)).length, 1);
      assert.equal((await stats(a)).summary.sourceReviewCount, 10);
      assert.equal(
        await a.state.renewSummary(
          productId,
          priorSummary.leaseToken,
          new Date(),
          new Date(),
        ),
        false,
      );
      assert.equal(
        await a.state.indexLeaseValid(
          ref(first).reviewId,
          leased.lease_token,
          new Date(),
        ),
        false,
      );

      await a.feed.append({ ...updated, visibility: 'withdrawn' }, 3);
      assert.deepEqual(
        await a.runtime.resolveSources(productId, [ref(updated)]),
        [],
      );
      assert.equal((await stats(a)).summary, null);
      await a.runtime.synchronize();
      await a.runtime.runPending();
      assert.equal((await stats(a)).ratingCount, 9);
      assert.equal((await stats(a)).summary, null);
      assert.equal((await point(a, updated)).length, 0);
      assert.equal((await point(b, first)).length, 1);
      assert.equal((await stats(b)).averageRating, 1);
      assert.match(
        (await a.runtime.answer(productId, 'walk')).sources[0].text,
        /store A/,
      );
      assert.equal(await a.state.cursor(), 15);
      const {
        rows: [projection],
      } = await pool.query(
        'SELECT to_jsonb(p) AS data FROM review_engine.publication p WHERE store_id=$1 AND review_id=$2',
        [a.storeId, ref(first).reviewId],
      );
      assert.equal(projection.data.revision, 3);
      assert.equal(projection.data.rating, null);
      assert.equal(projection.data.publication_id, ref(updated).publicationId);
      assert.doesNotMatch(
        JSON.stringify(projection.data),
        /Walk comfort|author/,
      );
      console.log(
        'PASS new Node process + PostgreSQL/Qdrant restart: source, cursor, revisions, timers, lease fencing, index/Summary recovery and revocation',
      );
    }
    assert.ok(
      Object.keys(require.cache).every(
        (path) =>
          !/[/\\]src[/\\](?:modules|product-consultation|ai|core[/\\]prisma|app\.module)/.test(
            path,
          ),
      ),
      'NextShop code loaded into portable host',
    );
  } finally {
    await Promise.all([
      a.runtime.close(),
      b.runtime.close(),
      peer.runtime.close(),
    ]);
    if (step === 'recover') {
      for (const h of [a, b]) {
        await httpQdrant('DELETE', '/collections/' + h.collection);
        for (const table of [
          'review_engine.publication',
          'review_engine.summary',
          'review_engine.cursor',
          'review_source_fixture.events',
          'review_source_fixture.stream',
        ]) {
          await pool.query(`DELETE FROM ${table} WHERE store_id=$1`, [
            h.storeId,
          ]);
        }
      }
    }
  }
}

try {
  if (phase === 'verify' && !run) {
    await withServices(({ pool }) => ensureIndependentDatabase(pool));
    const id = randomUUID();
    child('stage', id);
    await lifecycle('stop');
    await lifecycle('up');
    child('recover', id);
  } else if (
    ['stage', 'recover'].includes(phase) &&
    /^[0-9a-f-]{36}$/.test(run ?? '')
  ) {
    await withServices((services) => exercise(phase, run, services));
  } else {
    throw new Error('Usage: node infra/integration/portable-review.mjs verify');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
