import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withServices } from './environment.mjs';
import { campaignJournal, initializeCampaign, readCampaign } from './live-ai-budget.mjs';
import { createCampaignTransport, loadPolzaRoute, loadProviderConfig } from './live-ai-http.mjs';

const require = createRequire(import.meta.url);
const [action, dotenvFile] = process.argv.slice(2);
const offline = action === 'offline';
const provider = offline ? 'yandex' : action;
const offlineDir = offline ? mkdtempSync(join(tmpdir(), 'review-live-ai-offline-')) : null;
const journal = offlineDir ? join(offlineDir, 'campaign.json') : campaignJournal;
const resultFile = offlineDir ? join(offlineDir, 'retrieval.json')
  : new URL('../../.tmp/review-live-ai-retrieval-v1.json', import.meta.url);

const reviews = [
  'Ходила по асфальту час, стопы не устали.',
  'После долгой ходьбы жмёт в носке.',
  'В дождь промокли через ткань.',
  'Пятка мягкая, на прогулке не натирает.',
  'Плотная посадка, широким стопам тесно.',
  'Лёгкие на ноге, удобны в городе.',
  'Шнурки держатся, нога не болтается.',
  'Подошва приятно пружинит.',
  'В сухую погоду гулять комфортно.',
  'Понадобилось время, чтобы разносить.',
  'В зале устойчивые, на улице тяжеловаты.',
  'Брал для силовых, пятка хорошо держится.',
];
const questions = [
  { text: 'Удобно ли долго ходить по асфальту?', relevant: [1, 2, 4, 9] },
  { text: 'Подойдут ли для игры на снегу при минус двадцати?', relevant: [] },
  { text: 'Удобно ли, если стопа широкая?', relevant: [2, 5] },
  { text: 'Промокают ли под дождём?', relevant: [3] },
];
const retractionQuestion = 'Держит ли пятка на силовых тренировках?';
const caps = {
  summary: 800, 'qa-supported': 650, 'qa-insufficient': 650,
  'recommend-evidence': 950, 'recommend-no-evidence': 950,
};

function modelAdapter(transport, scenario) {
  return {
    open: (_task, schema) => ({
      // The application may invoke this repeatedly while sizing prompt chunks.
      // The transport independently reserves a higher bound for the wire payload.
      countTokens: async (text) => Math.ceil(Buffer.byteLength(text) / 2),
      async invoke(messages, signal) {
        const response = await transport.generate(provider, scenario, messages, caps[scenario], signal);
        if (!response.completed || typeof response.text !== 'string') throw new Error('Incomplete model response');
        return schema.parse(JSON.parse(response.text));
      },
    }),
  };
}

function printLedger() {
  for (const { provider, scenario, status, httpStatus, inputTokens, outputTokens,
    reasoningTokens, costNanoRub, reportedNanoRub, text, completed } of readCampaign().calls) {
    console.log(JSON.stringify({ provider, scenario, status, httpStatus, inputTokens, outputTokens,
      reasoningTokens, reservedRateRub: costNanoRub / 1e9, reportedNanoRub, completed, text }));
  }
}

function offlineFetch(url, { body: json }) {
  const body = JSON.parse(json);
  if (url.endsWith('/textEmbedding')) {
    const vector = Array(768).fill(0);
    const reviewIndex = reviews.indexOf(body.text);
    const question = questions.find(({ text }) => text === body.text);
    const expected = body.text === retractionQuestion ? 12 : question?.relevant[0] ?? 13;
    vector[reviewIndex < 0 ? expected : reviewIndex + 1] = 1;
    return Response.json({ embedding: vector, numTokens: '10' });
  }
  const instructions = body.messages[0].text;
  const question = body.messages[1].text;
  const text = instructions.includes('positiveImpressions') ? {
    summary: 'Кроссовки подходят некоторым покупателям для прогулок, но у других тесная посадка.',
    positiveImpressions: ['Удобно гулять'], negativeImpressions: ['Тесно в носке'],
  } : instructions.includes('usedPositions') ? {
    message: question.includes('минус двадцати') ? 'Нет отзывов об использовании на морозе.' : 'По отзывам, комфорт зависит от посадки.',
    usedPositions: [1],
  } : { message: 'Для городских прогулок лучше Тропа с гибкой подошвой.', recommendedPosition: 1 };
  return Response.json({ result: {
    alternatives: [{ status: 'ALTERNATIVE_STATUS_FINAL', message: { text: JSON.stringify(text) } }],
    usage: { inputTextTokens: '100', completionTokens: '30', totalTokens: '130' },
  } });
}

async function run({ pool, qdrantUrl, qdrantApiKey }, polzaRoute) {
  require('reflect-metadata');
  require('ts-node/register/transpile-only');
  require('tsconfig-paths/register');
  const { QdrantClient } = await import('@qdrant/js-client-rest');
  const { QdrantService } = require('@/src/core/qdrant/qdrant.service');
  const { QdrantReviewIndex } = require('@/src/review-intelligence/adapters/qdrant-review-index');
  const { PostgresReviewState } = require('@/src/review-intelligence/adapters/postgres-review-state');
  const { ReviewIndex } = require('@/src/review-intelligence/application/review-index');
  const { reviewSources } = require('@/src/review-intelligence/core/review-model');
  const { readReviewExperience } = require('@/src/review-intelligence/application/review-experience');
  const { generateReviewSummary } = require('@/src/review-intelligence/application/review-summary.model');
  const { answerProductReviewQuestion } = require('@/src/review-intelligence/application/review-answer');
  const { createProductRecommendationSynthesizer } = require('@/src/product-consultation/application/recommendation/product-recommendation-synthesizer');
  const { PostgresFixtureFeed, fixtureSql, productId, ticket, ref, uuid } = require('./portable-review-fixture.cjs');

  const secondProduct = uuid('review-live-ai-v1/SKU-TRAIN');
  const ratings = [5, 3, 2, 5, 3, 5, 5, 5, 5, 4, 3, 5];
  const entries = reviews.map((body, index) => ({
    ...ticket(index + 1, 1, ratings[index]), content: { stars: ratings[index], body },
  }));
  const entryNumber = new Map(entries.map((entry, index) => [ref(entry).reviewId, index + 1]));
  const productFor = (reviewId) => (entryNumber.get(reviewId) ?? 0) > 10 ? secondProduct : productId;
  class CampaignFeed extends PostgresFixtureFeed {
    async changesAfter(position, limit) {
      return (await super.changesAfter(position, limit)).map((row) => ({
        ...row, productId: productFor(row.reviewId),
      }));
    }
    async productExists(id) {
      return id === productId || id === secondProduct;
    }
    async listPublished(ids, id) {
      return (await this.latest(ids)).map((row) => ({ ...row, productId: productFor(row.id) }))
        .filter((row) => !id || row.productId === id);
    }
    async hasPublished(id) {
      return (await this.listPublished(null, id)).length > 0;
    }
  }
  const draft = { ...ticket(13, 1, null), visibility: 'draft' };
  const feed = new CampaignFeed(pool, offline ? `review-live-ai-v1-offline-${randomUUID()}` : 'review-live-ai-v1');
  await pool.query(fixtureSql);
  await pool.query(readFileSync(new URL('../../src/review-intelligence/adapters/postgres-review-state.sql', import.meta.url), 'utf8'));
  const initialHead = await feed.head();
  assert.ok(initialHead <= 14, 'Unexpected campaign fixture stream');
  for (const entry of [...entries, draft].slice(initialHead)) await feed.append(entry);
  const state = new PostgresReviewState(pool, feed);
  await state.synchronize();
  const sourceList = reviewSources(await feed.listPublished(null, productId));
  const experience = await readReviewExperience(state, [productId, secondProduct]);
  assert.equal(experience.get(secondProduct).ratingCount, initialHead === 14 ? 1 : 2);
  assert.equal(sourceList.length, 10);
  const qdrant = new QdrantService(new QdrantClient({
    url: qdrantUrl, apiKey: qdrantApiKey, checkCompatibility: false, timeout: 10_000,
  }));
  const vectors = new QdrantReviewIndex(qdrant, feed.storeId);
  const config = offline ? { yandex: {
    key: 'offline-key', model: 'gpt://offline/yandexgpt-5.1', dimensions: 768,
    doc: 'emb://offline/text-embeddings-v2-doc/latest', query: 'emb://offline/text-embeddings-v2-query/latest',
  } } : loadProviderConfig(dotenvFile);
  const transport = createCampaignTransport({ config, journal, polzaRoute,
    ...(offline ? { fetchImpl: offlineFetch } : {}) });
  const alreadyCalled = (scenario) => readCampaign(journal).calls.find((row) => row.provider === provider && row.scenario === scenario);
  const results = {};

  async function execute(scenario, operation) {
    const previous = alreadyCalled(scenario);
    if (previous) {
      results[scenario] = { status: 'ALREADY_SENT', completed: previous.completed };
      if (previous.status === 'settled' && previous.completed) {
        try { return JSON.parse(previous.text); } catch { return undefined; }
      }
      return undefined;
    }
    if (readCampaign(journal).stopped[provider]) {
      results[scenario] = { status: 'NOT_VERIFIED', reason: 'provider stopped' };
      return undefined;
    }
    try {
      const result = await operation(modelAdapter(transport, scenario));
      results[scenario] = { status: 'REVIEW_OUTPUT', result };
      return result;
    } catch (error) {
      const entry = alreadyCalled(scenario);
      results[scenario] = {
        status: entry?.status === 'settled' ? 'FAIL' : 'NOT_VERIFIED',
        reason: entry?.status ?? error.code ?? error.name,
        httpStatus: entry?.httpStatus,
      };
      return undefined;
    }
  }

  async function retrieval() {
    if (existsSync(resultFile)) {
      const saved = JSON.parse(readFileSync(resultFile, 'utf8'));
      assert.equal(saved.collection, vectors.collection);
      return saved;
    }
    let queryNumber = 0;
    const byText = new Map(entries.map((entry, index) => [entry.content.body, index + 1]));
    const embeddings = {
      space: () => ({ dimensions: 768, version: offline
        ? 'review-live-ai-offline/768' : 'yandex/text-embeddings-v2-doc+query/latest/768' }),
      embedDocument: async (text, signal) => {
        assert.ok(byText.has(text), 'Only synthetic review text may be embedded');
        return (await transport.embed(`embedding-doc-${byText.get(text)}`, text, signal)).vector;
      },
      embedQuery: async (text, signal) =>
        (await transport.embed(`embedding-query-${++queryNumber}`, text, signal)).vector,
    };
    const index = new ReviewIndex(feed, state, vectors, embeddings, { warn() {} });
    try {
      // PostgreSQL leases at most five jobs per batch. Process 12 reviews and
      // one draft without starting a scheduler or extending the call allowlist.
      for (let batch = 0; batch < 3 && !readCampaign(journal).stopped.yandex; batch++) {
        await index.runPending();
      }
      const indexed = await vectors.versions(entries.map((entry) => ref(entry).sourceId));
      assert.equal(indexed.size, 12, 'Expected all 12 real vectors');
      assert.ok([...indexed.values()].every(({ space }) => space === embeddings.space().version));
      const found = [];
      for (const question of questions) found.push(await index.search(productId, question.text));
      const matches = found.map((rows, index) => rows.slice(0, 3)
        .some((row) => questions[index].relevant.includes(entryNumber.get(row.reviewId))));
      // Keep the ten-review Summary corpus identical for later providers.
      const retracted = entries[11];
      const withdrawn = { ...retracted, edition: 2, visibility: 'withdrawn' };
      await feed.append(withdrawn);
      await state.synchronize();
      const after = await index.search(secondProduct, retractionQuestion);
      const scoped = found.flat().every((row) => row.productId === productId && entryNumber.has(row.reviewId))
        && after.length > 0 && after.every((row) => row.productId === secondProduct && entryNumber.has(row.reviewId));
      const filtered = scoped && after.every((row) => row.reviewId !== ref(withdrawn).reviewId);
      await index.runPending();
      const removed = (await vectors.versions([ref(retracted).sourceId])).size === 0;
      assert.equal((await feed.listPublished(null, productId)).length, sourceList.length);
      const result = {
        collection: vectors.collection, indexed: indexed.size, matches, filtered, removed,
        refs: found.slice(0, 2).map((rows) => rows.map(({ sourceId, reviewId, publicationId }) => ({ sourceId, reviewId, publicationId }))),
      };
      writeFileSync(resultFile, JSON.stringify(result), { flag: 'wx' });
      return result;
    } finally {
      await index.close();
    }
  }

  const summary = await execute('summary', async (models) => (await generateReviewSummary(
    models,
    sourceList.map(({ sourceId, publicationId, text, sourceKind }) => ({
      id: sourceId, publicationId, text, kind: sourceKind,
    })),
    { inputTokenBudget: 4_096, maxCalls: 1, signal: new AbortController().signal, checkLease: async () => {} },
  )).output);

  let evidence;
  if (provider === 'yandex' && !readCampaign(journal).stopped.yandex) {
    try { evidence = await retrieval(); } catch (error) {
      if (offline) throw error;
      results.retrieval = { status: 'NOT_VERIFIED', reason: error.code ?? error.message };
    }
  } else if (existsSync(resultFile)) {
    evidence = JSON.parse(readFileSync(resultFile, 'utf8'));
  }
  if (evidence) results.retrieval = {
    status: evidence.matches.filter(Boolean).length >= 3 && evidence.filtered && evidence.removed ? 'PASS' : 'FAIL',
    indexed: evidence.indexed, top3: evidence.matches, filtered: evidence.filtered, removed: evidence.removed,
  };

  const resolveSources = async (id, refs) => {
    const current = reviewSources(await feed.listPublished(refs.map(({ reviewId }) => reviewId), id));
    return refs.flatMap((r) => {
      const row = current.find((item) => item.sourceId === r.sourceId && item.publicationId === r.publicationId);
      return row ? [row] : [];
    });
  };
  for (const [number, scenario] of ['qa-supported', 'qa-insufficient'].entries()) {
    const refs = evidence?.refs[number] ?? [1, 2, 4, 5].map((n) => ref(entries[n - 1]));
    await execute(scenario, (models) => answerProductReviewQuestion(models, {
      search: (id) => resolveSources(id, refs), resolveSources,
    }, { productId, query: questions[number].text }));
    if (results[scenario]) results[scenario].evidence = evidence ? 'Yandex embeddings / Qdrant' : 'fixed published synthetic evidence';
  }

  const productFacts = [
    { position: 1, title: 'Кроссовки Тропа', description: 'Для ходьбы по городу. Лёгкая гибкая подошва.', profileId: 'SHOES', facts: [] },
    { position: 2, title: 'Кроссовки Опора', description: 'Для силовых тренировок. Жёсткая устойчивая подошва.', profileId: 'SHOES', facts: [] },
  ];
  const context = {
    version: 1, currentMessage: 'Какие кроссовки выбрать для часовых прогулок по городу?',
    recentMessages: [], task: null, searchCapabilities: null, results: null,
    productFacts, semanticEvidence: [], comparison: null, profile: null, usage: null,
  };
  const recommendationExperience = await readReviewExperience(state, [productId, secondProduct]);
  for (const scenario of ['recommend-evidence', 'recommend-no-evidence']) {
    await execute(scenario, (models) => createProductRecommendationSynthesizer({
      getChatModel: () => ({
        withStructuredOutput: (schema) => ({
          invoke: (messages, { signal }) => models.open('recommend', schema).invoke(
            messages.map(({ content }, index) => ({ content, role: index === 0 ? 'system' : 'user' })), signal,
          ),
        }),
      }),
    }).synthesize({
      context: {
        ...context,
        ...(scenario === 'recommend-evidence' && { reviewExperience: [productId, secondProduct].map((id, index) => ({
          position: index + 1, ...recommendationExperience.get(id),
          summary: index === 0 && summary ? { ...summary, sourceReviewCount: sourceList.length } : null,
        })) }),
      },
      observation: { kind: 'recommend', status: 'context_ready' },
    }));
  }
  if (offline) {
    assert.equal(results.retrieval?.status, 'PASS', JSON.stringify(results.retrieval));
    assert.ok(Object.entries(caps).every(([scenario]) => results[scenario]?.status === 'REVIEW_OUTPUT'), JSON.stringify(results));
    assert.equal(readCampaign(journal).calls.length, 22);
    console.log(JSON.stringify({ offline: 'PASS', isolatedCorpus: [10, 2], retrieval: results.retrieval,
      generations: 5, embeddings: 17 }));
    return;
  }
  console.log(JSON.stringify({ provider, results }));
}

if (action === 'report') {
  if (existsSync(journal)) printLedger();
  else console.log('No local campaign journal');
} else {
  assert.ok(offline || ['yandex', 'openai', 'polza'].includes(provider), 'Specify offline, yandex, openai, polza or report');
  let polzaRoute;
  if (offline) {
    initializeCampaign(journal);
  } else {
    const config = loadProviderConfig(dotenvFile);
    assert.ok(config[provider].key && config[provider].model, 'Approved model or existing key is unavailable');
    assert.equal(process.env.REVIEW_LIVE_AI_SCOPE_CONFIRMED, '1', 'Confirm the existing project scope before a paid run');
    if (provider === 'polza') polzaRoute = await loadPolzaRoute();
    if (!existsSync(campaignJournal)) {
      assert.equal(process.env.REVIEW_LIVE_AI_INITIALIZE, '1', 'Reconcile previous spend before initializing campaign');
      initializeCampaign();
    }
  }
  try {
    await withServices((services) => run(services, polzaRoute));
  } finally {
    if (offlineDir) {
      for (const path of [journal, resultFile]) if (existsSync(path)) unlinkSync(path);
      rmdirSync(offlineDir);
    }
  }
}
