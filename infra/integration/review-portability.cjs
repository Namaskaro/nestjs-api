const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const { ConfigService } = require('@nestjs/config');
const { createAiStub, summaryOutput } = require('./review-fixture.cjs');
const {
  ExternalReviewSource,
  ExternalReviewState,
} = require('./review-external-fixture.cjs');
const { externalRecommendation } = require('./review-consultation.cjs');
const {
  AiReviewModels,
} = require('@/src/review-intelligence/adapters/ai-review-models');
const {
  QdrantReviewIndex,
} = require('@/src/review-intelligence/adapters/qdrant-review-index');
const {
  ReviewIndex,
} = require('@/src/review-intelligence/application/review-index');
const {
  ReviewSummaries,
} = require('@/src/review-intelligence/application/review-summary');
const {
  readReviewExperience,
} = require('@/src/review-intelligence/application/review-experience');
const {
  answerProductReviewQuestion,
} = require('@/src/review-intelligence/application/review-answer');
const {
  reviewEvidenceIsCurrent,
  reviewStats,
} = require('@/src/review-intelligence/core/review-model');
const {
  nextReviewSummaryCount,
  isReviewSummaryMilestone,
} = require('@/src/review-intelligence/core/review-policy');
const {
  publishedReviewWhere,
} = require('@/src/modules/reviews/review-publication');

function loadSummaryWithoutHost() {
  const filename = require.resolve(
    '@/src/review-intelligence/application/review-summary.model',
  );
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  });
  const exports = {};
  runInNewContext(
    outputText,
    {
      exports,
      require(id) {
        assert.ok(
          ['node:crypto', 'zod'].includes(id),
          `Summary core imported a host dependency: ${id}`,
        );
        return require(id);
      },
    },
    { filename, timeout: 1000 },
  );
  return exports;
}

// A test-only second source with independent IDs and a different record shape.
function fromJsonLines(source) {
  const seen = new Set();
  return source.split('\n').flatMap((line) => {
    const { item, revision, body, visibility } = JSON.parse(line);
    if (
      visibility !== 'visible' ||
      !item ||
      !revision ||
      typeof body !== 'string' ||
      !body.trim() ||
      seen.has(item)
    )
      return [];
    seen.add(item);
    return [{ id: item, publicationId: revision, text: body, kind: 'review' }];
  });
}

async function summaryPortability({ db }, f) {
  const core = loadSummaryWithoutHost();
  const prismaSource = async () => {
    const rows = await db.review.findMany({
      where: { ...publishedReviewWhere, productId: f.corpus },
      orderBy: { publishedAt: 'asc' },
      select: { id: true, publicationId: true, text: true },
      take: 3,
    });
    return rows.map((row) => ({ ...row, kind: 'review' }));
  };
  const visible = await prismaSource();
  assert.equal(visible.length, 3);
  const otherShape = visible.map(({ text }, i) => ({
    item: `foreign:${i}`,
    revision: '1',
    body: text,
    visibility: 'visible',
  }));
  const alternate = () =>
    fromJsonLines(
      [
        ...otherShape,
        otherShape[0],
        {
          item: 'hidden',
          revision: '1',
          body: 'non-public',
          visibility: 'deleted',
        },
        { revision: '1', body: 'missing identity', visibility: 'visible' },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n'),
    );

  for (const load of [prismaSource, alternate]) {
    const input = await load();
    assert.equal(input.length, 3);
    const ai = createAiStub();
    let leaseChecks = 0;
    const result = await core.generateReviewSummary(
      new AiReviewModels(ai),
      input,
      {
        inputTokenBudget: 6000,
        maxCalls: 4,
        signal: new AbortController().signal,
        checkLease: async () => {
          leaseChecks++;
        },
      },
    );
    assert.equal(result.calls, 1);
    assert.deepEqual(result.output, summaryOutput);
    assert.equal(leaseChecks, 2);
    const prompt = ai.modelCalls[0].messages[1].content;
    for (const { text } of visible) assert.ok(prompt.includes(text));
    assert.doesNotMatch(prompt, /non-public|missing identity/);
    assert.equal(nextReviewSummaryCount(100), 110);
    assert.equal(isReviewSummaryMilestone(100, 109), false);
    assert.equal(isReviewSummaryMilestone(100, 110), true);
  }
}

function assertHostIndependentImports() {
  const root = resolve(__dirname, '../../src/review-intelligence');
  for (const layer of ['core', 'application']) {
    const dir = join(root, layer);
    for (const name of readdirSync(dir).filter((file) =>
      file.endsWith('.ts'),
    )) {
      const source = ts.createSourceFile(
        name,
        readFileSync(join(dir, name), 'utf8'),
        ts.ScriptTarget.Latest,
      );
      for (const node of source.statements) {
        const id = node.moduleSpecifier?.text;
        if (!id) continue;
        const path = resolve(dir, id);
        assert.ok(
          ['zod', 'class-validator', 'node:crypto'].includes(id) ||
            (id.startsWith('.') &&
              ['core', 'application'].some(
                (folder) => dirname(path) === join(root, folder),
              )),
          `Host dependency in ${layer}/${name}: ${id}`,
        );
      }
    }
  }
}

async function externalPortability(context, f) {
  assertHostIndependentImports();
  const { ai, qdrant, services } = context;
  const models = new AiReviewModels(
    ai,
    new ConfigService({ EMBEDDING_PROVIDER: 'yandex' }),
  );
  const logger = { warn() {}, log() {} };
  const ports = (suffix) => {
    const source = new ExternalReviewSource(
      `external-review-it-${f.runId}-${suffix}`,
      new Map([['SKU-7', f.corpus]]),
    );
    const state = new ExternalReviewState(source);
    const vectors = new QdrantReviewIndex(qdrant, source.storeId);
    return {
      source,
      state,
      vectors,
      index: new ReviewIndex(source, state, vectors, models, logger),
      summaries: new ReviewSummaries(
        state,
        models,
        () => ({ inputTokenBudget: 6000, maxCalls: 4 }),
        logger,
      ),
    };
  };
  const a = ports('a');
  const b = ports('b');
  assert.notEqual(a.vectors.collection, b.vectors.collection);
  assert.throws(
    () => new ReviewIndex(a.source, b.state, a.vectors, models, logger),
    /REVIEW_STORE_MISMATCH/,
  );
  assert.throws(
    () => new ReviewIndex(a.source, a.state, b.vectors, models, logger),
    /REVIEW_STORE_MISMATCH/,
  );
  const row = (i, text, stars = 5) => ({
    ticket: `ticket/${i}`,
    edition: 'initial',
    change: 1,
    sku: 'SKU-7',
    visibility: 'live',
    visibleSince: '2026-01-01T00:00:00.000Z',
    account: { key: `shop-account:${i}`, label: `Reader ${i}` },
    body: { comment: text, stars },
  });
  const rows = Array.from({ length: 10 }, (_, i) =>
    row(i, `Walk comfort from external A ${i}`, i === 9 ? 2 : 5),
  );
  const first = a.source.normalize(rows[0]);
  const ref = ({ id, publicationId }) => ({
    reviewId: id,
    publicationId,
    sourceId: publicationId,
  });
  const crossTenant = row(0, 'External B private to its own store', 1);
  assert.equal(
    first.publicationId,
    b.source.normalize(crossTenant).publicationId,
  );
  const existingHandler = ai.handlers.review_summary;
  ai.handlers.review_summary = () => ({
    ...summaryOutput,
    summary: 'External publication summary',
  });
  const created = [];
  try {
    for (const adapter of [a, b]) {
      await adapter.index.initializeCollection();
      created.push(adapter.vectors.collection);
    }
    for (const review of rows.slice(0, 9)) a.state.ingest(review);
    a.state.ingest({
      ...row('pending', 'Never published'),
      visibility: 'draft',
    });
    b.state.ingest(crossTenant);
    const experience = (adapter = a) =>
      readReviewExperience(adapter.state, [f.corpus]).then((values) =>
        values.get(f.corpus),
      );
    const calls = ai.modelCalls.length;
    await a.summaries.runPending();
    assert.equal(ai.modelCalls.length, calls);
    assert.equal((await experience()).ratingCount, 9);
    assert.equal((await experience()).summary, null);
    a.state.ingest(rows[9]);
    a.state.ingest(rows[9]); // Duplicate delivery.
    a.state.makeSummaryDue(f.corpus);
    await a.summaries.runPending();
    await a.index.runPending();
    await a.index.runPending();
    await b.index.runPending();
    const used = await experience();
    assert.equal(used.ratingCount, 10);
    assert.equal(used.averageRating, 4.7);
    assert.equal(used.positivePercent, 90);
    assert.equal(used.summary.summary, 'External publication summary');
    assert.equal((await experience(b)).averageRating, 1);
    assert.equal((await experience(b)).summary, null);
    assert.equal(
      (await a.index.resolveSources(f.other, [ref(first)])).length,
      0,
    );
    const hits = await a.index.search(f.corpus, 'walk comfort');
    assert.equal(hits.length, 10);
    assert.ok(hits.every(({ text }) => text.includes('external A')));
    const isolatedHits = await b.index.search(f.corpus, 'comfort');
    assert.deepEqual(
      isolatedHits.map(({ text }) => text),
      [crossTenant.body.comment],
    );
    const qa = await answerProductReviewQuestion(models, a.index, {
      productId: f.corpus,
      query: 'walk comfort',
    });
    assert.equal(qa.sources.length, 1);
    assert.ok(qa.sources[0].text.includes('external A'));
    const summaryPrompt = ai.modelCalls.findLast(
      ({ name }) => name === 'review_summary',
    ).messages[1].content;
    assert.doesNotMatch(summaryPrompt, /Never published|External B/);
    await externalRecommendation(
      context,
      f,
      {
        getReviewExperience: (ids) => readReviewExperience(a.state, ids),
        getProductStatsBatch: async (ids) =>
          reviewStats(ids, await a.state.ratingGroups(ids)),
      },
      a.index,
    );

    // A new edition withdraws the old publication even before its vector cleanup.
    const updated = {
      ...rows[0],
      change: 2,
      edition: 'edited',
      body: { stars: 4, comment: 'Updated comfort from A' },
    };
    a.state.ingest(updated);
    a.state.ingest(rows[0]); // An older delivery cannot restore the old publication.
    assert.equal((await experience()).summary, null);
    assert.equal(reviewEvidenceIsCurrent(used, await experience()), false);
    assert.deepEqual(await a.index.resolveSources(f.corpus, [ref(first)]), []);
    assert.equal(
      (await a.index.search(f.corpus, 'comfort')).some(
        (hit) => hit.publicationId === first.publicationId,
      ),
      false,
    );
    await a.index.runPending();
    assert.deepEqual(
      await qdrant.retrievePoints(a.vectors.collection, [first.publicationId]),
      [],
    );
    assert.equal(
      (await qdrant.retrievePoints(b.vectors.collection, [first.publicationId]))
        .length,
      1,
    );
    a.state.makeSummaryDue(f.corpus);
    await a.summaries.runPending();
    assert.equal((await experience()).summary.sourceReviewCount, 10);
    assert.equal((await experience()).averageRating, 4.6);
    assert.ok(
      (await a.index.search(f.corpus, 'updated comfort')).some(
        ({ text }) => text === updated.body.comment,
      ),
    );

    const oldQaHandler = ai.handlers.product_review_answer;
    ai.handlers.product_review_answer = () => {
      a.state.ingest({ ...updated, change: 3, visibility: 'withdrawn' });
      return { message: 'Superseded external evidence', usedPositions: [1] };
    };
    try {
      const picked = a.source.normalize(updated);
      // Control retrieval order so the withdrawn edition is among the prompt's sources.
      const retracted = await answerProductReviewQuestion(
        models,
        {
          search: () => a.index.resolveSources(f.corpus, [ref(picked)]),
          resolveSources: (id, refs) => a.index.resolveSources(id, refs),
        },
        { productId: f.corpus, query: 'updated comfort' },
      );
      assert.deepEqual(retracted.sources, []);
      assert.doesNotMatch(retracted.message, /Superseded/);
      assert.equal((await experience()).ratingCount, 9);
      assert.equal((await experience()).summary, null);
      await a.index.runPending();
      assert.deepEqual(
        await qdrant.retrievePoints(a.vectors.collection, [
          picked.publicationId,
        ]),
        [],
      );
      assert.equal((await experience(b)).ratingCount, 1);
    } finally {
      ai.handlers.product_review_answer = oldQaHandler;
    }
  } finally {
    ai.handlers.review_summary = existingHandler;
    await Promise.all([
      a.index.close(),
      b.index.close(),
      a.summaries.close(),
      b.summaries.close(),
    ]);
    for (const collection of created)
      await services.qdrant('DELETE', '/collections/' + collection);
  }
}

module.exports = { summaryPortability, externalPortability };
