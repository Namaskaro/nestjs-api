require('reflect-metadata');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { AppModule } = require('@/src/core/app.module');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { PrismaService } = require('@/src/core/prisma/prisma.service');
const { AiService } = require('@/src/ai/ai.service');
const { QDRANT_CLIENT } = require('@/src/core/qdrant/qdrant.constants');
const { QdrantService } = require('@/src/core/qdrant/qdrant.service');
const { RerankerService } = require('@/src/core/reranker/reranker.service');
const { ReviewsService } = require('@/src/modules/reviews/reviews.service');
const {
  ReviewIndexService,
} = require('@/src/modules/reviews/review-index.service');
const {
  ReviewSummaryService,
} = require('@/src/modules/reviews/review-summary.service');
const { RedisService } = require('@/src/modules/redis/redis.service');
const { createAi, reranker } = require('./ai.cjs');
const { seed } = require('./seed.cjs');
const { RedisStore } = require('connect-redis');
const session = require('express-session');
const { createClient } = require('redis');
const cookieParser = require('cookie-parser');
const qs = require('qs');

function allowed({ method, path }) {
  if (method === 'OPTIONS') return true;
  if (method === 'GET')
    return /^\/(products|categories|subcategories|brands|reviews|user|cart|chat)(\/|$)/.test(
      path,
    );
  if (method === 'POST')
    return /^\/(auth\/(login(\/access-token)?|logout)|cart\/get-or-create|reviews\/(create|[\w-]+\/addenda))$/.test(
      path,
    );
  if (method === 'PATCH')
    return /^\/reviews\/moderation\/(reviews|addenda)\/[\w-]+$/.test(path);
  if (method === 'PUT') return /^\/reviews\/[\w-]+\/vote$/.test(path);
  return method === 'DELETE' && /^\/reviews\/[\w-]+$/.test(path);
}

async function startBackend(services, { redisUrl, backendPort, controlToken }) {
  const { QdrantClient } = await import('@qdrant/js-client-rest');
  const client = new QdrantClient({
    url: services.qdrantUrl,
    apiKey: services.qdrantApiKey,
    checkCompatibility: false,
    timeout: 8000,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiService)
    .useValue(createAi())
    .overrideProvider('RESEND_TOKEN')
    .useValue({
      emails: {
        async send() {
          throw new Error('Email delivery is disabled in Review Live');
        },
      },
    })
    .overrideProvider(QDRANT_CLIENT)
    .useValue(client)
    .overrideProvider(RerankerService)
    .useValue(reranker)
    .compile();
  const app = moduleRef.createNestApplication({ abortOnError: false });
  const sessionClient = createClient({ url: redisUrl });
  sessionClient.on('error', (error) =>
    console.error('Review live session Redis:', error.message),
  );
  try {
    await sessionClient.connect();
    const db = app.get(PrismaService);
    const deps = {
      db,
      reviews: app.get(ReviewsService),
      qdrant: app.get(QdrantService),
      index: app.get(ReviewIndexService),
      summary: app.get(ReviewSummaryService),
    };
    let seeding;
    const populate = () =>
      (seeding ??= seed(deps).finally(() => {
        seeding = undefined;
      }));
    app.use((req, res, next) => {
      const authenticated =
        req.headers.authorization === `Bearer ${controlToken}`;
      if (
        req.path === '/__review-live/ready' &&
        req.method === 'GET' &&
        authenticated
      ) {
        void Promise.all([
          db.$queryRaw`SELECT 1`,
          client.getCollections(),
          sessionClient.ping(),
        ])
          .then(() => res.json({ postgres: true, qdrant: true, redis: true }))
          .catch(() =>
            res
              .status(503)
              .json({ error: 'Review Live dependency unavailable' }),
          );
      } else if (
        req.path === '/__review-live/seed' &&
        req.method === 'POST' &&
        authenticated
      ) {
        void populate()
          .then((result) => res.json(result))
          .catch((error) => {
            console.error(error);
            res.status(500).json({ error: 'Review live seeding failed' });
          });
      } else if (allowed(req)) next();
      else
        res.status(403).json({ message: 'Route unavailable in Review Live' });
    });
    app.use('query parser', (str) =>
      qs.parse(str, { arrayLimit: 100, comma: true }),
    );
    app.use(cookieParser());
    app.use(
      session({
        store: new RedisStore({
          client: sessionClient,
          prefix: 'review-live:',
        }),
        secret: process.env.SESSION_SECRET,
        name: 'review_live_sid',
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: 'lax', secure: false },
      }),
    );
    app.enableCors({ origin: process.env.CLIENT_URL, credentials: true });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    await app.get(RedisService).set('review-live:health', 'ok', 90);
    const seeded = await populate();
    await app.listen(backendPort, '127.0.0.1');
    return {
      seeded,
      close: async () => {
        try {
          await app.close();
        } finally {
          if (sessionClient.isOpen) await sessionClient.quit();
        }
      },
    };
  } catch (error) {
    await app.close().catch(() => {});
    if (sessionClient.isOpen) await sessionClient.quit().catch(() => {});
    throw error;
  }
}

module.exports = { startBackend };
