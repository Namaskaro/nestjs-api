const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const root = path.resolve(__dirname, '../../..');
const state = process.env.ACCEPTANCE_STATE_DIR;
assert.ok(state && path.isAbsolute(state) && fs.realpathSync(state) === fs.realpathSync(process.cwd()),
  'Launch from the explicit acceptance state directory');
const requireApp = createRequire(path.join(root, 'package.json'));
const front = 'http://127.0.0.1:41821';
const back = 'http://127.0.0.1:41820';
const redis = JSON.parse(fs.readFileSync(path.join(state, 'redis.json'), 'utf8'));
const clockFile = path.join(state, 'clock.json');
const dayMs = 86_400_000;
const clock = fs.existsSync(clockFile) ? JSON.parse(fs.readFileSync(clockFile, 'utf8')) : { anchor: Date.now(), day: 0 };
fs.writeFileSync(clockFile, JSON.stringify(clock));
const scopedClock = new AsyncLocalStorage();
const now = () => scopedClock.getStore() ?? new Date(clock.anchor + clock.day * dayMs);
const runAt = (time, callback) => scopedClock.run(new Date(time), callback);
const internalClockKey = randomBytes(32).toString('hex');
const host = new URL(back).host;
const token = randomBytes(32).toString('hex');
const fixture = require('./fixtures.cjs');
const scenarios = require('./scenarios.cjs');
const contextPanel = require('./user-context-panel.cjs');

async function main() {
  assert.ok(!fs.existsSync(path.join(process.cwd(), '.env')), 'Unexpected working .env');
  assert.match(redis.id, /^[a-f0-9]{64}$/);
  const inspected = execFileSync('docker', ['inspect', '--format',
    '{{json .Name}}|{{json .Config.Labels}}|{{json .NetworkSettings.Ports}}|{{json .State.Running}}', redis.id],
    { encoding: 'utf8', windowsHide: true }).trim().split('|').map(value => JSON.parse(value)).reduce(
      (object, value, index) => ({ ...object, [['name', 'labels', 'ports', 'running'][index]]: value }), {});
  assert.equal(inspected.labels['support-engine.acceptance'], 'agentic-memory-e4229ad');
  assert.deepEqual(inspected.ports['6379/tcp'], [{ HostIp: '127.0.0.1', HostPort: String(redis.port) }]);
  assert.equal(inspected.running, true);
  const { withServices } = await import(pathToFileURL(path.join(root, 'infra/integration/environment.mjs')).href);
  await withServices(async ({ project, databaseUrl, qdrantUrl, qdrantApiKey, qdrant, pool }) => {
    assert.equal(inspected.name, '/' + project + '-acceptance-redis');
    assert.equal(new URL(databaseUrl).hostname, '127.0.0.1');
    assert.equal(new URL(qdrantUrl).hostname, '127.0.0.1');
    const { rows: [{ count }] } = await pool.query('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
    const migrations = fs.readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true }).filter(entry => entry.isDirectory()).length;
    assert.equal(Number(count), migrations);
    const redisUrl = 'redis://:' + encodeURIComponent(redis.password) + '@127.0.0.1:' + redis.port + '/0';
    Object.assign(process.env, {
      NODE_ENV: 'development', POSTGRES_URI: databaseUrl, DATABASE_URL: databaseUrl,
      QDRANT_URL: qdrantUrl, REDIS_URL: redisUrl, REDIS_URI: redisUrl, REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(redis.port), REDIS_PASSWORD: redis.password,
      JWT_ACCESS_SECRET: process.env.ACCEPTANCE_SECRET, JWT_SECRET: process.env.ACCEPTANCE_SECRET,
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'), SESSION_SECRET: randomBytes(48).toString('hex'),
      SESSION_NAME: 'memory_v1_acceptance_sid', CLIENT_URL: front, SERVER_URL: back,
      CONSULTATION_MEMORY_ENABLED: '1', CONSULTATION_MEMORY_WRITE_V2: '1', USER_CONTEXT_ENABLED: '1', CONSULTATION_MEMORY_STORE_KEY: 'browser-acceptance-e4229ad',
      LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false',
      MAIL_HOST: '127.0.0.1', MAIL_PORT: '1', MAIL_LOGIN: 'acceptance', MAIL_PASSWORD: 'acceptance',
      RESEND_API_KEY: 're_acceptance', ALLOWED_ORIGIN: front,
      S3_ENDPOINT: 'http://127.0.0.1:1', S3_REGION: 'local', S3_ACCESS_KEY_ID: 'acceptance',
      S3_SECRET_ACCESS_KEY: 'acceptance', S3_BUCKET_NAME: 'acceptance',
      GOOGLE_CLIENT_ID: 'acceptance', GOOGLE_CLIENT_SECRET: 'acceptance',
      YANDEX_CLIENT_ID: 'acceptance', YANDEX_CLIENT_SECRET: 'acceptance',
      VK_CLIENT_ID: 'acceptance', VK_CLIENT_SECRET: 'acceptance',
    });
    requireApp('ts-node/register/transpile-only');
    requireApp('tsconfig-paths').register({ baseUrl: root, paths: { '@/*': ['*'], '@prisma/generated': ['prisma/generated'], '@prisma/generated/*': ['prisma/generated/*'] } });
    const src = module => requireApp(path.join(root, 'src', module));
    const { Test } = requireApp('@nestjs/testing');
    const { Module, Global, Logger, ValidationPipe } = requireApp('@nestjs/common');
    const { AppModule } = src('core/app.module');
    const { AiService } = src('ai/ai.service');
    const { RerankerService } = src('core/reranker/reranker.service');
    const { QDRANT_CLIENT } = src('core/qdrant/qdrant.constants');
    const { QdrantClient } = requireApp('@qdrant/js-client-rest');
    const { ConsultationMemoryService, CONSULTATION_MEMORY_CLOCK } = src('consultation-memory/consultation-memory.service');
    const { PrismaService } = src('core/prisma/prisma.service');
    const { ChatService } = src('modules/chat/chat.service');
    const { ChatGateway } = src('modules/chat/chat.gateway');
    const { vector, original, ai } = require('./ai.cjs')(requireApp);
    class AcceptanceClockModule {}
    Module({ providers: [{ provide: CONSULTATION_MEMORY_CLOCK, useValue: now }], exports: [CONSULTATION_MEMORY_CLOCK] })(AcceptanceClockModule);
    Global()(AcceptanceClockModule);
    const testing = await Test.createTestingModule({ imports: [AppModule, AcceptanceClockModule] })
      .overrideProvider(AiService).useValue(ai)
      .overrideProvider(RerankerService).useValue({ rerank: async (_query, items, _getText, limit) =>
        items.slice(0, limit ?? 5).map((item, index) => ({ item, score: 1 / (index + 1) })) })
      .overrideProvider(QDRANT_CLIENT).useValue(new QdrantClient({ url: qdrantUrl, apiKey: qdrantApiKey, timeout: 5000 }))
      .compile();
    const app = testing.createNestApplication();
    app.useLogger(new Logger());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    const session = requireApp('express-session');
    const { RedisStore } = requireApp('connect-redis');
    const IORedis = requireApp('ioredis');
    const sessionClient = new IORedis(redisUrl, { connectTimeout: 2500, maxRetriesPerRequest: 1 });
    assert.equal(await sessionClient.ping(), 'PONG');
    app.use(session({
      store: new RedisStore({ client: sessionClient, prefix: 'sessions:' }),
      secret: process.env.SESSION_SECRET, name: process.env.SESSION_NAME,
      resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 30 * dayMs },
    }));
    app.use(requireApp('cookie-parser')());
    app.use('query parser', text => requireApp('qs').parse(text, { arrayLimit: 100, comma: true }));
    app.enableCors({ origin: [front], credentials: true, exposedHeaders: 'set-cookie' });
    const express = app.getHttpAdapter().getInstance();
    express.get('/uploads/acceptance-shoe.svg', (_req, res) => res.type('image/svg+xml').send(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 210"><rect width="320" height="210" fill="#e6edf3"/><path d="M55 120l47-24 14-26 31 6 31 33 70 17 23 22-8 19H50l-6-20z" fill="#36546d"/><path d="M50 153h213" stroke="#fff" stroke-width="5"/></svg>'));
    let identities;
    let preparing = false;
    const prisma = app.get(PrismaService);
    const localRequest = req => req.socket.remoteAddress === '127.0.0.1' && req.get('host') === host;
    const authorize = req => localRequest(req) && req.get('origin') === back && req.get('x-acceptance-token') === token;
    const chat = app.get(ChatService);
    const memory = app.get(ConsultationMemoryService);
    const atStart = callback => runAt(clock.anchor, callback);
    const reset = (name, clearProfile = true, reseed = true) => atStart(() =>
      fixture.reset({ prisma, chat, memory, identities, name, original, clearProfile, reseed }));
    const setDay = day => {
      clock.day = day;
      fs.writeFileSync(clockFile, JSON.stringify(clock));
      return { day, now: now() };
    };

    express.use('/__acceptance', (req, res, next) => {
      if (!localRequest(req)) return res.sendStatus(403);
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      next();
    });
    express.use((req, res, next) => {
      const key = req.get('x-acceptance-clock-key');
      if (!key) return next();
      const timestamp = Number(req.get('x-acceptance-clock-at'));
      const scopedRoute = /^\/(me\/user-context(\/|$)|chat\/[a-f0-9-]+\/consultation-episodes(\/|$))/.test(req.path);
      if (!localRequest(req) || key !== internalClockKey || !scopedRoute ||
          !Number.isSafeInteger(timestamp) || timestamp < clock.anchor || timestamp > clock.anchor + 120 * dayMs) {
        return res.sendStatus(403);
      }
      runAt(timestamp, next);
    });
    express.get('/__acceptance', (_req, res) => {
      const toAccount = name => ({ name, email: fixture.address(name) });
      const accounts = fixture.accounts.filter(name => !name.startsWith('verify')).map(toAccount);
      const contextAccounts = contextPanel.accounts.map(toAccount);
      res.type('html').send(require('./dashboard.cjs')({
        front, now: now(), day: clock.day, token, accounts, contextAccounts, password: fixture.password,
      }));
    });
    const changeScenario = prepare => async (req, res) => {
      if (!authorize(req)) return res.sendStatus(403);
      const scenario = scenarios.find(item => item.key === req.params.name);
      if (!scenario) return res.sendStatus(404);
      if (preparing) return res.sendStatus(409);
      preparing = true;
      try {
        if (scenario.account) await reset(scenario.account, false, prepare);
        return res.json(prepare ? setDay(scenario.day) : { day: clock.day, hasAccount: Boolean(scenario.account) });
      } catch (error) {
        console.error('Acceptance scenario change failed:', error.name);
        return res.status(500).json({ message: 'Не удалось изменить данные тестового сценария.' });
      } finally {
        preparing = false;
      }
    };
    express.post('/__acceptance/prepare/:name', changeScenario(true));
    express.post('/__acceptance/reset-scenario/:name', changeScenario(false));
    contextPanel.install({
      express, back, authorize, fixture, internalClockKey, anchor: clock.anchor,
      identityOf: name => identities[name],
      prepare: name => atStart(() => fixture.seedEpisode(chat, memory, identities[name], name, original)),
      inspectExpiry: async (identity, episodeId, at) => {
        const { userId, chatId } = identity;
        const { consultationOffer } = await runAt(at, () => memory.getResumeState(chatId, userId));
        const stored = await prisma.consultationEpisode.findFirst({
          where: {
            id: episodeId,
            scope: { storeKey: process.env.CONSULTATION_MEMORY_STORE_KEY, subjectKey: userId, chatId },
          },
          select: {
            offers: { where: { id: consultationOffer?.offerId ?? '' }, select: { id: true } },
          },
        });
        return { restoreAvailable: Boolean(stored?.offers.length), historySaved: Boolean(stored) };
      },
      reset,
    });
    express.post('/__acceptance/time/:day', (req, res) => {
      if (!authorize(req)) return res.sendStatus(403);
      const day = Number(req.params.day);
      if (!Number.isInteger(day) || day < 0 || day > 120) return res.sendStatus(400);
      if (preparing) return res.sendStatus(409);
      return res.json(setDay(day));
    });
    express.post('/__acceptance/reset/:name', async (req, res) => {
      if (!authorize(req)) return res.sendStatus(403);
      if (clock.day !== 0 || !fixture.accounts.includes(req.params.name)) return res.sendStatus(409);
      await reset(req.params.name);
      return res.sendStatus(204);
    });
    express.post('/__acceptance/reconnect/:name', (req, res) => {
      if (!authorize(req)) return res.sendStatus(403);
      const identity = identities[req.params.name];
      if (!identity || !fixture.accounts.includes(req.params.name)) return res.sendStatus(404);
      const namespace = app.get(ChatGateway).server.sockets;
      const ids = [...(namespace.adapter.rooms.get('chat:' + identity.chatId) ?? [])];
      for (const id of ids) namespace.sockets.get(id)?.conn.close();
      return res.json({ disconnected: ids.length });
    });
    await app.init();
    identities = await fixture.provision({ prisma, chat: app.get(ChatService), memory: app.get(ConsultationMemoryService),
      qdrant, requireApp, vector, original });
    await app.listen(41820, '127.0.0.1');
    console.log('ACCEPTANCE_READY', project, 'migrations=' + migrations, 'Redis PONG', back);
  });
}
main().catch(error => { console.error(error); process.exit(1); });
