require('reflect-metadata');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { UnauthorizedException, ValidationPipe } = require('@nestjs/common');
const { ConfigService } = require('@nestjs/config');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { PrismaService } = require('@/src/core/prisma/prisma.service');
const { QdrantService } = require('@/src/core/qdrant/qdrant.service');
const { ReviewsService } = require('@/src/modules/reviews/reviews.service');
const {
  ReviewsController,
} = require('@/src/modules/reviews/reviews.controller');
const {
  ReviewModerationController,
} = require('@/src/modules/reviews/review-moderation.controller');
const {
  ReviewIndexService,
} = require('@/src/modules/reviews/review-index.service');
const {
  ReviewSummaryService,
} = require('@/src/modules/reviews/review-summary.service');
const { JwtAuthGuard } = require('@/src/modules/auth/guards/jwt-auth.guard');

const due = new Date(0);
const dimensions = 768;
const vector = Array.from({ length: dimensions }, (_, i) => Number(i === 0));
const spec = {
  provider: 'yandex',
  queryModel: 'integration-query',
  documentModel: 'integration-document',
  dimensions,
};
const summaryOutput = {
  positiveImpressions: ['Покупатели отмечают удобство.'],
  negativeImpressions: [],
  summary: 'В отзывах описано удобство при ходьбе.',
};

function createAiStub() {
  const documentCalls = [];
  const queryCalls = [];
  const modelCalls = [];
  const handlers = {
    review_summary: () => summaryOutput,
    product_review_answer: () => ({
      message: 'В опубликованных отзывах отмечают удобство.',
      usedPositions: [1],
    }),
    product_recommendation_response: () => ({
      message: 'Первый товар подходит по указанным критериям.',
      recommendedPosition: 1,
    }),
  };
  return {
    documentCalls,
    queryCalls,
    modelCalls,
    handlers,
    documentVector: () => vector,
    embeddingFailover: false,
    getEmbeddingSpec: (provider) => {
      assert.equal(provider, 'yandex');
      return spec;
    },
    async createDocumentEmbedding(text) {
      documentCalls.push(text);
      return this.documentVector();
    },
    async createQueryEmbedding(text) {
      queryCalls.push(text);
      return vector;
    },
    getChatModel(kind) {
      assert.equal(kind, 'STANDARD');
      return {
        getNumTokens: async (text) => Math.ceil(text.length / 4),
        withStructuredOutput: (_schema, { name }) => ({
          async invoke(messages, options) {
            modelCalls.push({ name, messages });
            options?.signal?.throwIfAborted();
            assert.ok(
              Object.hasOwn(handlers, name),
              `Unexpected AI call: ${name}`,
            );
            return handlers[name](messages, options);
          },
        }),
      };
    },
  };
}

function fixture() {
  const runId = randomUUID();
  const [main, other, corpus] = Array.from({ length: 3 }, () => randomUUID());
  const buyers = Array.from({ length: 21 }, () => randomUUID());
  return {
    runId,
    main,
    other,
    corpus,
    buyers,
    outsider: randomUUID(),
    manager: randomUUID(),
  };
}

async function seed(db, f) {
  const users = [...f.buyers, f.outsider, f.manager];
  await db.$transaction(async (tx) => {
    await tx.user.createMany({
      data: users.map((id, i) => ({
        id,
        email: `${f.runId}.${i}@review-it.invalid`,
        name: `Review IT ${i}`,
        role: id === f.manager ? 'Manager' : 'Client',
      })),
    });
    const products = [f.main, f.other, f.corpus];
    await tx.product.createMany({
      data: products.map((id, i) => ({
        id,
        title: `Review IT ${f.runId} ${i}`,
        description: 'Synthetic comfort walking shoes',
        price: '1000',
        images: [],
        type: 'SHOES',
        gender: 'UNISEX',
        inStock: id !== f.corpus,
        stock: id === f.corpus ? 0 : 5,
      })),
    });
    const item = (productId) => ({
      productId,
      title: 'Review IT item',
      image: null,
      quantity: 1,
      size: null,
      price: '1000',
    });
    await tx.order.createMany({
      data: [...f.buyers, f.outsider].map((userId) => ({
        userId,
        cartId: randomUUID(),
        status: userId === f.outsider ? 'DRAFT' : 'DELIVERED',
        items: products.map(item),
        totalAmount: 3000,
        finalAmount: 3000,
        comment: f.runId,
      })),
    });
  });
}

async function clean(context, f) {
  const { db, qdrant, services } = context;
  const ids = [f.main, f.other, f.corpus];
  const productId = { in: ids };
  const users = [...f.buyers, f.outsider, f.manager];
  const collections = (await services.qdrant('GET', '/collections')).result
    .collections;
  if (collections.some(({ name }) => name === 'reviews')) {
    await services.qdrant(
      'POST',
      '/collections/reviews/points/delete?wait=true',
      {
        filter: { must: [{ key: 'productId', match: { any: ids } }] },
      },
    );
    const { result } = await services.qdrant(
      'POST',
      '/collections/reviews/points/count',
      {
        exact: true,
        filter: { must: [{ key: 'productId', match: { any: ids } }] },
      },
    );
    assert.equal(result.count, 0);
  }
  if (collections.some(({ name }) => name === 'products')) {
    await qdrant.removeIndexPoints('products', ids);
    assert.deepEqual(await qdrant.retrievePoints('products', ids), []);
  }
  await db.$transaction(async (tx) => {
    // Review children and ReviewSummary use FK cascades.
    await tx.review.deleteMany({ where: { productId, userId: { in: users } } });
    await tx.order.deleteMany({
      where: { userId: { in: users }, comment: f.runId },
    });
    await tx.product.deleteMany({
      where: { id: productId, title: { contains: f.runId } },
    });
    await tx.user.deleteMany({
      where: { id: { in: users }, email: { startsWith: `${f.runId}.` } },
    });
  });
  assert.equal(await db.review.count({ where: { productId } }), 0);
  assert.equal(await db.reviewSummary.count({ where: { productId } }), 0);
  assert.equal(await db.order.count({ where: { userId: { in: users } } }), 0);
  assert.equal(await db.product.count({ where: { id: productId } }), 0);
  assert.equal(await db.user.count({ where: { id: { in: users } } }), 0);
}

async function withReviewServices(callback) {
  const { withServices } = await import('./environment.mjs');
  const { QdrantClient } = await import('@qdrant/js-client-rest');
  return withServices(async (services) => {
    const db = new PrismaService({
      datasources: { db: { url: services.databaseUrl } },
    });
    const qdrant = new QdrantService(
      new QdrantClient({
        url: services.qdrantUrl,
        apiKey: services.qdrantApiKey,
        checkCompatibility: false,
        timeout: 10_000,
      }),
    );
    const config = new ConfigService({
      EMBEDDING_PROVIDER: 'yandex',
      REVIEW_INDEX_ENABLED: 'false',
      REVIEW_SUMMARY_ENABLED: 'false',
      REVIEW_SUMMARY_INPUT_TOKENS: 6000,
      REVIEW_SUMMARY_MAX_CALLS: 32,
    });
    const ai = createAiStub();
    const workers = [];
    const indexWorker = () => {
      const worker = new ReviewIndexService(db, ai, qdrant, config);
      workers.push(worker);
      return worker;
    };
    const summaryWorker = () => {
      const worker = new ReviewSummaryService(db, ai, config);
      workers.push(worker);
      return worker;
    };
    const reviews = new ReviewsService(db);
    try {
      const [identity] =
        await db.$queryRaw`SELECT current_database() AS db, current_user AS role`;
      assert.deepEqual(identity, {
        db: 'support_engine_it',
        role: 'support_engine_it',
      });
      return await callback({
        services,
        db,
        qdrant,
        ai,
        reviews,
        index: indexWorker(),
        summary: summaryWorker(),
        indexWorker,
        summaryWorker,
      });
    } finally {
      await Promise.all(workers.map((worker) => worker.onModuleDestroy()));
      await db.$disconnect();
    }
  });
}

async function withReviewHttp(reviews, f, callback) {
  const identities = new Map([
    ...[...f.buyers, f.outsider].map((id) => [id, 'Client']),
    [f.manager, 'Manager'],
  ]);
  const app = (
    await Test.createTestingModule({
      controllers: [ReviewsController, ReviewModerationController],
      providers: [{ provide: ReviewsService, useValue: reviews }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context) {
          const req = context.switchToHttp().getRequest();
          const id = req.headers['x-review-it-user'];
          const role = identities.get(id);
          if (!role) throw new UnauthorizedException();
          req.user = { id, role };
          return true;
        },
      })
      .compile()
  ).createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  try {
    await app.init();
    return await callback(request(app.getHttpServer()));
  } finally {
    await app.close();
  }
}

module.exports = {
  clean,
  createAiStub,
  dimensions,
  due,
  fixture,
  seed,
  spec,
  summaryOutput,
  vector,
  withReviewHttp,
  withReviewServices,
};
