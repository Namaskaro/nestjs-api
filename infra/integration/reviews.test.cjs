const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { test } = require('node:test');
const {
  clean,
  due,
  fixture,
  seed,
  spec,
  summaryOutput,
  vector,
  withReviewHttp,
  withReviewServices,
} = require('./review-fixture.cjs');
const { embeddingSpace } = require('@/src/ai/embedding-execution');
const {
  reviewPopularityScore,
} = require('@/src/modules/reviews/review-publication');
const { consultationCases } = require('./review-consultation.cjs');
const {
  summaryPortability,
  externalPortability,
} = require('./review-portability.cjs');

const approved = ({ publicationId }) => ({
  publicationId,
  decision: 'PUBLISHED',
});
const query = 'waterproof comfort';
const modelCalls = (ai) =>
  ai.modelCalls.filter(({ name }) => name === 'review_summary');

async function step(t, title, callback) {
  let passed = false;
  await t.test(title, async () => {
    await callback();
    passed = true;
  });
  assert.ok(passed, `Cannot continue after: ${title}`);
}

async function indexUntilIdle(context, f) {
  const { db, index } = context;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (
      !(await db.review.count({
        where: {
          productId: { in: [f.main, f.other, f.corpus] },
          indexPending: true,
        },
      }))
    )
      return;
    await index.runPending();
  }
  assert.fail('Review index did not drain due fixture jobs');
}

async function createPending({ db, reviews, index, ai, qdrant }, f) {
  const body = { productId: f.main, text: 'waterproof comfort', rating: 5 };
  await index.initializeCollection();
  await withReviewHttp(reviews, f, async (http) => {
    await http.post('/reviews/create').send(body).expect(401);
    await http
      .post('/reviews/create')
      .set('x-review-it-user', f.outsider)
      .send({ ...body, userId: f.buyers[0] })
      .expect(400)
      .expect(({ body }) => assert.equal(body.code, 'NO_DELIVERED_PURCHASE'));
    for (const invalid of [{ rating: 6 }, { text: '  ' }, { rating: 2.5 }]) {
      await http
        .post('/reviews/create')
        .set('x-review-it-user', f.buyers[0])
        .send({ ...body, ...invalid })
        .expect(400);
    }
    const created = await Promise.all(
      [1, 2].map(() =>
        http
          .post('/reviews/create')
          .set('x-review-it-user', f.buyers[0])
          .send(body),
      ),
    );
    assert.deepEqual(created.map(({ status }) => status).sort(), [201, 409]);
    f.primary = created.find(({ status }) => status === 201).body;
    assert.equal(f.primary.status, 'PENDING');
    assert.equal(await db.review.count({ where: { productId: f.main } }), 1);
    const review = await db.review.findUniqueOrThrow({
      where: { id: f.primary.id },
    });
    const order = await db.order.findUniqueOrThrow({
      where: { id: review.verifiedOrderId },
    });
    assert.equal(order.userId, f.buyers[0]);
    assert.equal(order.status, 'DELIVERED');
    await http
      .get(`/reviews/${f.main}`)
      .expect(200)
      .expect(({ body }) => assert.deepEqual(body.items, []));
    await http
      .get(`/reviews/${f.main}/mine`)
      .set('x-review-it-user', f.outsider)
      .expect(200)
      .expect(({ body }) => assert.equal(body.review, null));
    await http
      .patch(`/reviews/moderation/reviews/${f.primary.id}`)
      .set('x-review-it-user', f.buyers[0])
      .send(approved(f.primary))
      .expect(403);
    await http
      .delete(`/reviews/${f.primary.id}`)
      .set('x-review-it-user', f.outsider)
      .query({ publicationId: f.primary.publicationId })
      .expect(404);
    await index.runPending();
    assert.deepEqual(ai.documentCalls, []);
    assert.deepEqual(
      await qdrant.retrievePoints('reviews', [f.primary.publicationId]),
      [],
    );
    assert.deepEqual(await index.search(f.main, query), []);
    assert.deepEqual(ai.queryCalls, []);
    await http
      .patch(`/reviews/moderation/reviews/${f.primary.id}`)
      .set('x-review-it-user', f.manager)
      .send(approved(f.primary))
      .expect(200);
    await http
      .get(`/reviews/${f.main}`)
      .expect(200)
      .expect(({ body }) => {
        assert.equal(body.items[0].id, f.primary.id);
        assert.doesNotMatch(
          JSON.stringify(body),
          /@review-it\.invalid|verifiedOrderId|moderatedBy/,
        );
      });
  });
}

async function transactionCases({ db, reviews, services }, f) {
  const { id, publicationId } = f.primary;
  await assert.rejects(
    db.review.create({
      data: {
        userId: f.buyers[0],
        productId: f.main,
        text: 'Duplicate',
        rating: 4,
      },
    }),
    { code: 'P2002' },
  );
  await assert.rejects(
    services.pool.query('UPDATE "Review" SET rating = 6 WHERE id = $1', [id]),
    { code: '23514', constraint: 'Review_published_content_check' },
  );
  await assert.rejects(
    reviews.setVote(randomUUID(), id, { publicationId, value: 'UP' }),
    { code: 'P2003' },
  );
  const afterRollback = await db.review.findUniqueOrThrow({ where: { id } });
  assert.equal(afterRollback.upVotes, 0);
  assert.equal(afterRollback.downVotes, 0);
  assert.equal(await db.reviewVote.count({ where: { reviewId: id } }), 0);
  assert.equal(afterRollback.rating, 5);

  const updates = await Promise.allSettled([
    reviews.setVote(f.buyers[1], id, { publicationId, value: 'UP' }),
    reviews.setVote(f.buyers[2], id, { publicationId, value: 'DOWN' }),
    reviews.setVote(f.buyers[1], id, { publicationId, value: 'DOWN' }),
  ]);
  assert.ok(updates.some(({ status }) => status === 'fulfilled'));
  for (const update of updates) {
    if (update.status === 'rejected')
      assert.equal(update.reason.getStatus(), 409);
  }
  const votes = await db.reviewVote.findMany({ where: { reviewId: id } });
  assert.ok(votes.length >= 1);
  assert.equal(new Set(votes.map(({ userId }) => userId)).size, votes.length);
  const up = votes.filter(({ value }) => value === 'UP').length;
  const down = votes.filter(({ value }) => value === 'DOWN').length;
  const row = await db.review.findUniqueOrThrow({ where: { id } });
  assert.deepEqual(
    [row.upVotes, row.downVotes, row.popularityScore],
    [up, down, reviewPopularityScore(up, down)],
  );
  const [vote] = votes;
  await assert.rejects(
    db.reviewVote.create({
      data: { reviewId: id, userId: vote.userId, publicationId, value: 'UP' },
    }),
    { code: 'P2002' },
  );
  assert.deepEqual(await reviews.getOwnVotes(f.outsider, f.main, [id]), []);
  assert.deepEqual(await reviews.getOwnVotes(vote.userId, f.other, [id]), []);

  f.pending = await reviews.createReview(f.buyers[1], {
    productId: f.main,
    rating: 1,
    text: 'pending-secret',
  });
  f.rejected = await reviews.createReview(f.buyers[2], {
    productId: f.main,
    rating: 2,
    text: 'rejected-secret',
  });
  await reviews.moderateReview(f.manager, f.rejected.id, {
    publicationId: f.rejected.publicationId,
    decision: 'REJECTED',
    reason: 'Synthetic moderation',
  });
  f.foreign = await reviews.createReview(f.buyers[0], {
    productId: f.other,
    rating: 1,
    text: 'other-product-private-marker',
  });
  const moderatorResults = await Promise.allSettled([
    reviews.moderateReview(f.manager, f.foreign.id, approved(f.foreign)),
    reviews.moderateReview(f.manager, f.foreign.id, approved(f.foreign)),
  ]);
  assert.ok(moderatorResults.some(({ status }) => status === 'fulfilled'));
  for (const result of moderatorResults) {
    if (result.status === 'rejected')
      assert.equal(result.reason.getStatus(), 409);
    else assert.equal(result.value.status, 'PUBLISHED');
  }
  assert.equal(
    (await reviews.moderateReview(f.manager, f.foreign.id, approved(f.foreign)))
      .status,
    'PUBLISHED',
  );
  assert.equal(
    (
      await db.reviewSummary.findUniqueOrThrow({
        where: { productId: f.other },
      })
    ).corpusVersion,
    1,
  );
  assert.deepEqual(await reviews.getProductStats(f.main), {
    averageRating: 5,
    ratingCount: 1,
    positiveCount: 1,
    neutralCount: 0,
    negativeCount: 0,
    positivePercent: 100,
  });
  assert.equal((await reviews.getProductStats(f.other)).averageRating, 1);
}

async function indexAndRetrieval(context, f) {
  const { db, reviews, index, ai, qdrant, services } = context;
  await indexUntilIdle(context, f);
  assert.equal(ai.documentCalls.length, 2);
  const primaryText = ai.documentCalls.find((text) =>
    text.includes('waterproof'),
  );
  assert.equal(primaryText, query);
  const { id, publicationId } = f.primary;
  const text = 'waterproof '.repeat(360) + 't'.repeat(40);
  assert.equal(text.length, 4000);
  f.addendum = await reviews.addAddendum(f.buyers[0], id, {
    publicationId,
    text,
  });
  const rejectedAddendum = await reviews.addAddendum(f.buyers[0], id, {
    publicationId,
    text: 'rejected-addendum-secret',
  });
  await reviews.moderateAddendum(f.manager, rejectedAddendum.id, {
    publicationId,
    decision: 'REJECTED',
    reason: 'Synthetic moderation',
  });
  await index.runPending();
  assert.equal(ai.documentCalls.length, 2);
  assert.deepEqual(
    (await reviews.getProductReviews(f.main)).items[0].addenda,
    [],
  );
  await reviews.moderateAddendum(f.manager, f.addendum.id, {
    publicationId,
    decision: 'PUBLISHED',
  });
  await index.runPending();
  assert.deepEqual(ai.documentCalls.slice(2), [text]);
  const realPoints = await qdrant.retrievePoints('reviews', [
    publicationId,
    f.addendum.id,
    f.foreign.publicationId,
  ]);
  assert.equal(realPoints.length, 3);
  for (const { payload } of realPoints) {
    assert.equal(payload._embedding_space, embeddingSpace(spec));
    assert.equal(Object.hasOwn(payload, 'text'), false);
  }
  assert.equal(
    (await qdrant.keywordSearch('reviews', 'waterproof', 10)).length,
    2,
  );
  assert.deepEqual(
    new Set(
      (await index.search(f.main, query)).map(({ sourceId }) => sourceId),
    ),
    new Set([publicationId, f.addendum.id]),
  );

  const fake = (
    id,
    reviewId,
    currentPublicationId,
    space = embeddingSpace(spec),
  ) =>
    qdrant.savePoint('reviews', {
      id,
      vector: { dense: vector, bm25: { text: query, model: 'qdrant/bm25' } },
      payload: {
        productId: f.main,
        reviewId,
        publicationId: currentPublicationId,
        _embedding_space: space,
      },
    });
  for (const hidden of [f.pending, f.rejected, f.foreign]) {
    await fake(hidden.publicationId, hidden.id, hidden.publicationId);
  }
  const wrongSpace = randomUUID();
  await fake(wrongSpace, id, publicationId, 'another-space');
  const raw = await qdrant.hybridSearch('reviews', vector, query, 16, {
    must: [{ key: 'productId', match: { value: f.main } }],
  });
  assert.ok(
    [f.pending, f.rejected, f.foreign].every(({ publicationId }) =>
      raw.some(({ id }) => id === publicationId),
    ),
  );
  assert.ok(raw.some(({ id }) => id === wrongSpace));
  assert.deepEqual(
    new Set(
      (await index.search(f.main, query)).map(({ sourceId }) => sourceId),
    ),
    new Set([publicationId, f.addendum.id]),
  );
  await qdrant.removeIndexPoints('reviews', [
    f.pending.publicationId,
    f.rejected.publicationId,
    wrongSpace,
  ]);
  await db.review.update({
    where: { id: f.foreign.id },
    data: { indexPending: true },
  });
  // Remove the altered point so the actual worker has to restore its payload.
  await qdrant.removeIndexPoints('reviews', [f.foreign.publicationId]);
  await index.runPending();
  assert.equal((await index.search(f.other, query))[0].reviewId, f.foreign.id);

  await reviews.deleteReview(f.buyers[0], id, publicationId);
  const recreated = await reviews.createReview(f.buyers[0], {
    productId: f.main,
    rating: 5,
    text: 'waterproof comfort again',
  });
  assert.equal(recreated.id, id);
  assert.notEqual(recreated.publicationId, publicationId);
  assert.equal(await db.reviewVote.count({ where: { reviewId: id } }), 0);
  await assert.rejects(
    reviews.setVote(f.buyers[1], id, { publicationId, value: 'UP' }),
    (error) => error.getStatus() === 404,
  );
  await reviews.moderateReview(f.manager, recreated.id, approved(recreated));
  assert.equal(
    (await qdrant.retrievePoints('reviews', [publicationId, f.addendum.id]))
      .length,
    2,
  );
  assert.deepEqual(await index.search(f.main, query), []);
  await assert.rejects(
    reviews.deleteReview(f.buyers[0], id, publicationId),
    (error) => error.getResponse().code === 'REVIEW_STATE_CHANGED',
  );
  await index.runPending();
  assert.deepEqual(
    await qdrant.retrievePoints('reviews', [publicationId, f.addendum.id]),
    [],
  );
  assert.deepEqual(
    (await index.search(f.main, query)).map(({ sourceId }) => sourceId),
    [recreated.publicationId],
  );
  f.primary = recreated;

  // A malformed embedding is rejected by real Qdrant. The durable job retries.
  await qdrant.removeIndexPoints('reviews', [recreated.publicationId]);
  await db.review.update({ where: { id }, data: { indexPending: true } });
  ai.documentVector = () => [1];
  await index.runPending();
  ai.documentVector = () => vector;
  const failed = await db.review.findUniqueOrThrow({ where: { id } });
  assert.equal(failed.indexPending, true);
  assert.equal(failed.indexAttempts, 1);
  assert.equal(failed.indexLeaseToken, null);
  assert.ok(failed.indexNextAttemptAt > new Date());
  const calls = ai.documentCalls.length;
  await index.runPending();
  assert.equal(ai.documentCalls.length, calls);
  await db.review.update({ where: { id }, data: { indexNextAttemptAt: due } });
  await index.runPending();
  assert.equal(
    (await index.search(f.main, query))[0].sourceId,
    recreated.publicationId,
  );
  assert.equal(
    (await db.review.findUniqueOrThrow({ where: { id } })).indexPending,
    false,
  );
  const { result } = await services.qdrant('GET', '/collections/reviews');
  assert.equal(result.config.params.vectors.dense.size, 768);
  for (const key of [
    'reviewId',
    'publicationId',
    'productId',
    '_embedding_space',
  ])
    assert.equal(result.payload_schema[key].data_type, 'keyword');
}

async function publishCorpus(reviews, f, from, to) {
  for (let i = from; i < to; i++) {
    const text =
      i < 10
        ? `Опыт ходьбы ${i}.`
        : `Опыт ${i}. ` + 'Комфорт при ходьбе. '.repeat(185).trimEnd();
    const row = await reviews.createReview(f.buyers[i], {
      productId: f.corpus,
      rating: 5,
      text,
    });
    await reviews.moderateReview(f.manager, row.id, approved(row));
    f.corpusReviews.push(row);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function delayedIndexWrite(context, f) {
  const { db, reviews, index, indexWorker, qdrant } = context;
  const previous = f.primary;
  const entered = deferred();
  const release = deferred();
  const savePoint = qdrant.savePoint.bind(qdrant);
  await qdrant.removeIndexPoints('reviews', [previous.publicationId]);
  await db.review.update({
    where: { id: previous.id },
    data: { indexPending: true },
  });
  qdrant.savePoint = async (collection, point) => {
    if (point.id !== previous.publicationId)
      return savePoint(collection, point);
    entered.resolve();
    await release.promise;
    await savePoint(collection, point);
    throw new Error(
      'Synthetic lost acknowledgement after Qdrant committed the old point',
    );
  };
  const oldJob = index.runPending();
  try {
    await Promise.race([
      entered.promise,
      oldJob.then(() => {
        throw new Error('Index job returned before upsert');
      }),
    ]);
    assert.ok(
      (await db.review.findUniqueOrThrow({ where: { id: previous.id } }))
        .indexLeaseToken,
    );
    await indexWorker().runPending();
    assert.deepEqual(
      await qdrant.retrievePoints('reviews', [previous.publicationId]),
      [],
    );
    await reviews.deleteReview(
      f.buyers[0],
      previous.id,
      previous.publicationId,
    );
    f.primary = await reviews.createReview(f.buyers[0], {
      productId: f.main,
      rating: 5,
      text: 'waterproof comfort after delayed write',
    });
    await reviews.moderateReview(f.manager, f.primary.id, approved(f.primary));
    await indexWorker().runPending();
    assert.equal(
      (await qdrant.retrievePoints('reviews', [f.primary.publicationId]))
        .length,
      1,
    );
  } finally {
    release.resolve();
    try {
      await oldJob;
    } finally {
      qdrant.savePoint = savePoint;
    }
  }
  assert.deepEqual(
    await qdrant.retrievePoints('reviews', [previous.publicationId]),
    [],
  );
  assert.deepEqual(
    (await index.search(f.main, query)).map(({ sourceId }) => sourceId),
    [f.primary.publicationId],
  );
  const current = await db.review.findUniqueOrThrow({
    where: { id: f.primary.id },
  });
  assert.equal(current.indexPending, false);
  assert.equal(current.indexAttempts, 0);
}

async function holdSummary({ ai, summary }, callback) {
  const entered = deferred();
  const release = deferred();
  const prior = ai.handlers.review_summary;
  ai.handlers.review_summary = async () => {
    entered.resolve();
    await release.promise;
    return summaryOutput;
  };
  const running = summary.runPending();
  try {
    await Promise.race([
      entered.promise,
      running.then(() => {
        throw new Error('Summary job returned before model invocation');
      }),
    ]);
    await callback();
  } finally {
    release.resolve();
    try {
      await running;
    } finally {
      ai.handlers.review_summary = prior;
    }
  }
}

async function summaryThresholds(context, f) {
  const { db, reviews, summary, summaryWorker, ai } = context;
  const where = { productId: f.corpus };
  const state = () => db.reviewSummary.findUniqueOrThrow({ where });
  f.corpusReviews = [];
  await publishCorpus(reviews, f, 0, 9);
  assert.equal((await state()).nextAttemptAt, null);
  await summary.runPending();
  assert.equal(modelCalls(ai).length, 0);
  await publishCorpus(reviews, f, 9, 10);
  assert.ok((await state()).nextAttemptAt);
  await db.reviewSummary.update({ where, data: { nextAttemptAt: due } });

  await holdSummary(context, async () => {
    const leased = await state();
    assert.ok(leased.leaseToken);
    assert.ok(leased.leaseUntil > new Date());
    await summaryWorker().runPending();
    assert.equal(modelCalls(ai).length, 1);
    assert.equal((await state()).leaseToken, leased.leaseToken);
    const deadline = Date.now() + 46_000;
    while (
      (await state()).leaseUntil <= leased.leaseUntil &&
      Date.now() < deadline
    ) {
      await sleep(250);
    }
    assert.ok(
      (await state()).leaseUntil > leased.leaseUntil,
      'Heartbeat did not renew lease during invoke',
    );
  });
  assert.equal(modelCalls(ai).length, 1);
  const ready = await state();
  assert.equal(ready.summary, summaryOutput.summary);
  assert.equal(ready.sourceReviewCount, 10);
  assert.equal(ready.sourceAuthorCount, 10);
  assert.equal(ready.nextAttemptAt, null);
  assert.equal(ready.leaseToken, null);

  const [first] = f.corpusReviews;
  const addendum = await reviews.addAddendum(f.buyers[0], first.id, {
    publicationId: first.publicationId,
    text: 'Дополнение для следующего порога',
  });
  await reviews.moderateAddendum(f.manager, addendum.id, approved(first));
  assert.equal((await state()).requestedVersion, ready.requestedVersion);
  assert.equal((await state()).nextAttemptAt, null);
  await summary.runPending();
  assert.equal(modelCalls(ai).length, 1);
  await publishCorpus(reviews, f, 10, 19);
  assert.equal((await state()).nextAttemptAt, null);
  await publishCorpus(reviews, f, 19, 20);
  assert.ok((await state()).nextAttemptAt);
  await db.reviewSummary.update({ where, data: { nextAttemptAt: due } });
  ai.handlers.review_summary = () => {
    throw new Error('Synthetic transient model error');
  };
  await summary.runPending();
  const failure = await state();
  assert.equal(failure.summary, ready.summary);
  assert.equal(failure.lastErrorCode, 'REVIEW_SUMMARY_GENERATION_FAILED');
  assert.equal(failure.attemptCount, 1);
  assert.equal(failure.leaseToken, null);
  assert.ok(failure.nextAttemptAt > new Date());
  await summary.runPending();
  assert.equal(modelCalls(ai).length, 2);

  // Model an abandoned lease with a persisted expiration. The next instance
  // must recover after restarting both services, using their original volumes.
  await db.reviewSummary.update({
    where,
    data: {
      nextAttemptAt: due,
      leaseToken: randomUUID(),
      leaseUntil: due,
    },
  });
}

async function afterRestart(context, f) {
  const { db, reviews, summary, ai, index, qdrant } = context;
  const where = { productId: f.corpus };
  const state = () => db.reviewSummary.findUniqueOrThrow({ where });
  assert.equal(
    (await state()).lastErrorCode,
    'REVIEW_SUMMARY_GENERATION_FAILED',
  );
  assert.equal(
    (await index.search(f.main, query))[0].sourceId,
    f.primary.publicationId,
  );
  assert.ok(
    (await db.review.findUniqueOrThrow({ where: { id: f.primary.id } }))
      .indexPending,
  );
  await indexUntilIdle(context, f);
  assert.equal(
    (await qdrant.retrievePoints('reviews', [f.primary.publicationId])).length,
    1,
  );
  await summary.runPending();
  assert.ok(
    modelCalls(ai).length >= 3,
    'Expected map batches followed by reduce',
  );
  assert.match(
    modelCalls(ai).at(-1).messages[1].content,
    /positiveImpressions/,
  );
  assert.equal((await state()).sourceReviewCount, 20);
  assert.equal((await state()).lastErrorCode, null);
  assert.equal((await state()).leaseToken, null);

  await publishCorpus(reviews, f, 20, 21);
  assert.equal((await state()).nextAttemptAt, null);
  const [first, second] = f.corpusReviews;
  await reviews.deleteReview(f.buyers[0], first.id, first.publicationId);
  assert.equal(
    (await reviews.getReviewExperience([f.corpus])).get(f.corpus).summary,
    null,
  );
  await db.reviewSummary.update({ where, data: { nextAttemptAt: due } });
  await holdSummary(context, async () => {
    assert.ok((await state()).leaseToken);
    await reviews.deleteReview(f.buyers[1], second.id, second.publicationId);
    assert.equal((await state()).leaseToken, null);
  });
  assert.equal((await state()).summary, null);
  assert.equal((await state()).generatedAt, null);
  assert.ok((await state()).nextAttemptAt);
  await db.reviewSummary.update({ where, data: { nextAttemptAt: due } });
  await summary.runPending();
  assert.equal((await state()).sourceReviewCount, 19);
  assert.equal((await state()).summary, summaryOutput.summary);
}

test(
  'Review Intelligence V2 on attested Shared Integration Test Environment',
  { timeout: 180_000 },
  async (t) => {
    const f = fixture();
    let seeded = false;
    const { lifecycle } = await import('./environment.mjs');
    try {
      await withReviewServices(async (context) => {
        const { db } = context;
        assert.equal(
          await db.review.count(),
          0,
          'Use an empty, dedicated Review integration environment',
        );
        assert.equal(await db.reviewSummary.count(), 0);
        await seed(db, f);
        seeded = true;
        await step(
          t,
          'HTTP, purchase ownership, role, validation, pending visibility and parallel create',
          () => createPending(context, f),
        );
        await step(
          t,
          'PostgreSQL constraints, rollback, concurrent votes/moderation and statistics',
          () => transactionCases(context, f),
        );
        await step(
          t,
          'Real Qdrant hybrid retrieval, forged/stale refs, reindex, deletion and retry',
          () => indexAndRetrieval(context, f),
        );
        await step(
          t,
          'Concurrent index lease, delayed real upsert and lost acknowledgement',
          () => delayedIndexWrite(context, f),
        );
        await step(
          t,
          'Summary 9/10/19/20, addenda, real concurrent lease, heartbeat and retry',
          () => summaryThresholds(context, f),
        );
        await db.review.update({
          where: { id: f.primary.id },
          data: {
            indexPending: true,
            indexLeaseToken: randomUUID(),
            indexLeaseUntil: due,
          },
        });
      });
      await step(
        t,
        'Real PostgreSQL and Qdrant restart, persisted jobs, map/reduce and invalidation',
        async () => {
          await lifecycle('stop');
          await lifecycle('up');
          await withReviewServices((context) => afterRestart(context, f));
        },
      );
      await withReviewServices(async (context) => {
        await step(
          t,
          'ProductAgent search, Compare, Recommendation, Review Q&A and retraction',
          () => consultationCases(context, f),
        );
        await step(
          t,
          'Unchanged Summary core with real Prisma rows and independent JSON Lines source',
          () => summaryPortability(context, f),
        );
        await step(
          t,
          'Independent review feed through shared application, real Qdrant and isolated stores',
          () => externalPortability(context, f),
        );
      });
    } finally {
      if (seeded) {
        await step(
          t,
          'Exact synthetic fixture cleanup in PostgreSQL and Qdrant',
          () => withReviewServices((context) => clean(context, f)),
        );
      }
    }
  },
);
