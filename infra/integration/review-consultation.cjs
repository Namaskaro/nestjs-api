const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { dimensions, vector } = require('./review-fixture.cjs');
const {
  CurrentStoreCatalogService,
} = require('@/src/product-consultation/adapters/current-store/current-store-catalog.service');
const {
  CurrentStoreProductSearchService,
} = require('@/src/product-consultation/adapters/current-store/current-store-product-search.service');
const {
  CurrentStoreSearchSpecAdapter,
} = require('@/src/product-consultation/adapters/current-store/current-store-search-spec.adapter');
const {
  ProductAgentService,
} = require('@/src/product-consultation/application/agent/product-agent.service');
const {
  createExecuteProductDecisionNode,
} = require('@/src/product-consultation/application/agent/nodes/execute-product-decision.node');
const {
  ProductConsultantDecisionSchema,
} = require('@/src/product-consultation/application/consultant/product-consultant-decision.schema');
const {
  createConsultationApplicationRecord,
  ConsultationApplicationRecordSchema,
} = require('@/src/product-consultation/application/runtime/consultation-application-record');
const {
  beginSearchExecution,
  commitSearchExecution,
} = require('@/src/product-consultation/core/results/consultation-results');
const {
  createSearchSpec,
} = require('@/src/product-consultation/core/search/search-spec');
const {
  createProductConsultationState,
} = require('@/src/product-consultation/core/state/consultation-state');

async function seedCatalogPoints({ db, qdrant }, f) {
  await qdrant.createEmbeddingCollection('products', dimensions);
  const [brandId, categoryId, subcategoryId] = Array.from({ length: 3 }, () =>
    randomUUID(),
  );
  for (const id of [f.main, f.other, f.corpus]) {
    const row = await db.product.findUniqueOrThrow({ where: { id } });
    await qdrant.savePoint('products', {
      id,
      vector: {
        dense: vector,
        bm25: { text: row.description, model: 'qdrant/bm25' },
      },
      payload: {
        productId: id,
        title: row.title,
        description: row.description,
        brandId,
        brand: 'Synthetic brand',
        categoryId,
        category: 'Footwear',
        subcategoryId,
        subcategory: 'Walking shoes',
        color: null,
        price: 1000,
        gender: row.gender,
        type: row.type,
        sizes: [],
        // The corpus fixture is out of stock in PostgreSQL. The deliberately
        // stale index must not allow it into the catalog result.
        stock: 5,
        image: '',
        inStock: true,
        searchText: row.description,
        semanticRepresentation: {
          summary: 'Synthetic walking shoes',
          targetAudience: [],
          styleAssociations: [],
          useCases: [],
          pricePositioning: 'Fixture',
          searchTags: [],
        },
      },
    });
  }
}

function activeRecord(search, products) {
  const base = createConsultationApplicationRecord();
  const started = beginSearchExecution(base.results, search, randomUUID);
  return ConsultationApplicationRecordSchema.parse({
    ...base,
    revision: 1,
    generation: 1,
    state: createProductConsultationState(search),
    results: commitSearchExecution(
      started.state,
      started.executionId,
      products,
      randomUUID,
    ),
  });
}

function decision(action, positions, reviewQuery) {
  return ProductConsultantDecisionSchema.parse({
    proposal: {
      action,
      taskTransition: 'continue',
      search: null,
      searchPatch: null,
      memoryObservations: [],
      selection: { kind: 'positions', positions },
      feedback: null,
    },
    usageScenarioIds: [],
    factAttributeIds: ['price'],
    terminalText: null,
    ...(reviewQuery ? { reviewQuery } : {}),
  });
}

async function consultationCases(context, f) {
  const { db, reviews, index, ai, qdrant } = context;
  await seedCatalogPoints(context, f);
  const catalog = new CurrentStoreCatalogService(db, qdrant);
  let gap = 0.0001;
  let rerankerFails = false;
  const reranker = {
    async rerank(_query, candidates) {
      assert.deepEqual(
        new Set(candidates.map(({ product }) => product.id)),
        new Set([f.main, f.other]),
      );
      if (rerankerFails) throw new Error('Synthetic reranker outage');
      return [f.other, f.main].map((id) => ({
        item: candidates.find(({ product }) => product.id === id),
        score: id === f.other ? 0.5 + gap : 0.5,
      }));
    },
  };
  const originalWeight = process.env.REVIEW_RATING_WEIGHT;
  let searchService;
  try {
    process.env.REVIEW_RATING_WEIGHT = '0.005';
    searchService = new CurrentStoreProductSearchService(
      ai,
      qdrant,
      reranker,
      db,
      catalog,
      reviews,
    );
  } finally {
    if (originalWeight === undefined) delete process.env.REVIEW_RATING_WEIGHT;
    else process.env.REVIEW_RATING_WEIGHT = originalWeight;
  }
  const agent = new ProductAgentService(
    catalog,
    searchService,
    new CurrentStoreSearchSpecAdapter(searchService),
    reviews,
    index,
  );
  const search = createSearchSpec({
    semanticIntent: 'comfort walking shoes',
    category: 'SHOES',
    constraints: [],
  });
  const near = await agent.search(search);
  assert.deepEqual(
    near.map(({ productId }) => productId),
    [f.main, f.other],
  );
  gap = 0.05;
  assert.deepEqual(
    (await agent.search(search)).map(({ productId }) => productId),
    [f.other, f.main],
  );
  rerankerFails = true;
  assert.deepEqual(
    new Set((await agent.search(search)).map(({ productId }) => productId)),
    new Set([f.main, f.other]),
  );

  // Make the existing corpus eligible for a recommendation with a ready Summary.
  const corpus = await db.product.update({
    where: { id: f.corpus },
    data: { inStock: true, stock: 5 },
  });
  const record = activeRecord(search, [
    ...near,
    {
      productId: f.corpus,
      title: corpus.title,
      price: corpus.price,
      image: null,
    },
  ]);
  const execute = createExecuteProductDecisionNode(ai, agent);
  const run = (action, positions, reviewQuery) =>
    execute({
      query: reviewQuery ?? 'Сравните варианты для прогулок',
      conversationId: f.runId,
      requestId: randomUUID(),
      recentMessages: [],
      consultationRecord: record,
      decision: decision(action, positions, reviewQuery),
    });
  const count = ai.modelCalls.length;
  const embeddingCount = ai.queryCalls.length;
  const compare = await run('COMPARE', [1, 2]);
  assert.deepEqual(
    compare.consultation?.comparisonPresentation?.products.map(
      ({ averageRating, ratingCount }) => [averageRating, ratingCount],
    ),
    [
      [5, 1],
      [1, 1],
    ],
  );
  assert.equal(ai.modelCalls.length, count);
  assert.equal(ai.queryCalls.length, embeddingCount);
  const recommend = await run('RECOMMEND', [1, 3]);
  assert.deepEqual(recommend.recommendationProductIds, [f.main]);
  assert.deepEqual(
    recommend.recommendationReviewEvidence.products.map(
      ({ productId, ratingCount }) => [productId, ratingCount],
    ),
    [
      [f.main, 1],
      [f.corpus, 19],
    ],
  );
  assert.equal(recommend.recommendationReviewEvidence.summary, null);
  const recoCalls = ai.modelCalls.slice(count);
  assert.deepEqual(
    recoCalls.map(({ name }) => name),
    ['product_recommendation_response'],
  );
  assert.equal(ai.queryCalls.length, embeddingCount);
  const contextPayload = JSON.parse(recoCalls[0].messages[1].content).context;
  assert.equal(contextPayload.reviewExperience[0].averageRating, 5);
  assert.equal(contextPayload.reviewExperience[1].ratingCount, 19);
  assert.ok(contextPayload.reviewExperience[1].summary);
  assert.doesNotMatch(
    JSON.stringify(contextPayload.reviewExperience),
    /lastRetractionVersion|sourceVersion|pending-secret|rejected-secret/,
  );

  const qa = await run('DETAILS', [1], 'waterproof comfort');
  const presentation = qa.consultation?.productDetailsPresentation;
  assert.equal(presentation?.reviewExperience.averageRating, 5);
  assert.deepEqual(
    presentation.reviewAnswer.sources.map(({ sourceId, productId, rating }) => [
      sourceId,
      productId,
      rating,
    ]),
    [[f.primary.publicationId, f.main, 5]],
  );
  const qaCall = ai.modelCalls.at(-1);
  assert.equal(qaCall.name, 'product_review_answer');
  assert.doesNotMatch(
    JSON.stringify(qaCall.messages),
    /pending-secret|rejected-secret|other-product-private-marker|@review-it\.invalid/,
  );

  const sourceText = presentation.reviewAnswer.sources[0].text;
  ai.handlers.product_review_answer = () => ({
    message: `Покупатель пишет: «${sourceText}».`,
    usedPositions: [1],
  });
  const quoted = await run('DETAILS', [1], 'waterproof comfort');
  const quotedAnswer =
    quoted.consultation?.productDetailsPresentation.reviewAnswer;
  assert.match(quotedAnswer.message, /Краткий вывод/);
  assert.ok(!quotedAnswer.message.includes(sourceText));
  assert.equal(quotedAnswer.sources[0].text, sourceText);

  ai.handlers.product_review_answer = () => ({
    message: 'Invalid sources',
    usedPositions: [4],
  });
  const invalid = await run('DETAILS', [1], 'waterproof comfort');
  assert.equal(invalid.failed, true);
  assert.equal(invalid.consultation, null);

  ai.handlers.product_review_answer = async () => {
    await reviews.deleteReview(
      f.buyers[0],
      f.primary.id,
      f.primary.publicationId,
    );
    return { message: 'Synthetic retracted answer', usedPositions: [1] };
  };
  const retracted = await run('DETAILS', [1], 'waterproof comfort');
  assert.deepEqual(
    retracted.consultation?.productDetailsPresentation.reviewAnswer.sources,
    [],
  );
  assert.doesNotMatch(retracted.message, /Synthetic retracted answer/);
  const beforeEmpty = ai.modelCalls.length;
  const empty = await run('DETAILS', [1], 'waterproof comfort');
  assert.deepEqual(
    empty.consultation?.productDetailsPresentation.reviewAnswer.sources,
    [],
  );
  assert.equal(ai.modelCalls.length, beforeEmpty);
  await index.runPending();
  assert.deepEqual(
    await qdrant.retrievePoints('reviews', [f.primary.publicationId]),
    [],
  );
}

async function externalRecommendation(context, f, evidence, index) {
  const { db, qdrant, ai } = context;
  const catalog = new CurrentStoreCatalogService(db, qdrant);
  const agent = new ProductAgentService(
    catalog,
    undefined,
    undefined,
    evidence,
    index,
  );
  const search = createSearchSpec({
    semanticIntent: 'comfort walking shoes',
    category: 'SHOES',
    constraints: [],
  });
  const rows = await db.product.findMany({
    where: { id: { in: [f.corpus, f.other] } },
  });
  const record = activeRecord(
    search,
    [f.corpus, f.other].map((id) => {
      const row = rows.find((product) => product.id === id);
      return { productId: id, title: row.title, price: row.price, image: null };
    }),
  );
  const calls = ai.modelCalls.length;
  const execute = createExecuteProductDecisionNode(ai, agent);
  const run = (action) =>
    execute({
      query: 'Какой вариант выбрать для прогулок?',
      conversationId: f.runId,
      requestId: randomUUID(),
      recentMessages: [],
      consultationRecord: record,
      decision: decision(action, [1, 2]),
    });
  const compared = await run('COMPARE');
  assert.deepEqual(
    compared.consultation.comparisonPresentation.products.map(
      ({ averageRating, ratingCount }) => [averageRating, ratingCount],
    ),
    [
      [4.7, 10],
      [null, 0],
    ],
  );
  assert.equal(ai.modelCalls.length, calls);
  const result = await run('RECOMMEND');
  assert.deepEqual(result.recommendationProductIds, [f.corpus]);
  assert.deepEqual(
    result.recommendationReviewEvidence.products.map(
      ({ productId, ratingCount }) => [productId, ratingCount],
    ),
    [
      [f.corpus, 10],
      [f.other, 0],
    ],
  );
  assert.equal(
    result.recommendationReviewEvidence.summary.summary,
    'External publication summary',
  );
  assert.deepEqual(
    ai.modelCalls.slice(calls).map(({ name }) => name),
    ['product_recommendation_response'],
  );
}

module.exports = { consultationCases, externalRecommendation };
