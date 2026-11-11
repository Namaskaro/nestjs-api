import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  dockerCli,
  lifecycle,
  project,
  requireTest,
  root,
  withServices,
} from './environment.mjs';

const require = createRequire(import.meta.url);
const frontend = resolve(root, '../frontend');
const runtime = join(root, '.tmp', 'review-live');
const statePath = join(runtime, 'state.json');
const lock = join(runtime, 'start.lock');
const logPath = join(runtime, 'store.log');
const host = '127.0.0.1';
const redisName = `${project}-review-redis`;
const redisImage =
  'redis@sha256:a1e0a3b3a6cedd74d8ba44805b2497b93851a296f08a44962fedc03f1c490b47';
const redisPassword = createHash('sha256')
  .update(redisName + '-test-only')
  .digest('hex');

function envBase() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(SystemRoot|windir|TEMP|TMP|TMPDIR|PATH|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|SystemDrive|ComSpec|ProgramFiles|DOCKER_CONFIG)$/i.test(
        key,
      ),
    ),
  );
}

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...envBase(), NODE_ENV: 'test' },
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  requireTest(
    result.status === 0,
    `Runner failed: ${args.at(-1)} (${result.status})`,
  );
}

function redisContainer(docker) {
  const names = docker('ps', '-a', '--format', '{{.Names}}').split(/\r?\n/);
  if (!names.includes(redisName)) return null;
  const [container] = JSON.parse(docker('container', 'inspect', redisName));
  const config = container.Config;
  requireTest(
    config.Labels?.['review-live.owner'] === project &&
      config.Image === redisImage &&
      config.Cmd.includes(redisPassword) &&
      container.HostConfig.AutoRemove &&
      container.HostConfig.PortBindings?.['6379/tcp']?.[0]?.HostIp === host &&
      container.Mounts.every((mount) => mount.Type === 'tmpfs'),
    'Unexpected Redis container identity',
  );
  return container;
}

async function startRedis(docker) {
  if (!redisContainer(docker))
    docker(
      'run',
      '-d',
      '--rm',
      '--name',
      redisName,
      '--label',
      `review-live.owner=${project}`,
      '--publish',
      `${host}::6379`,
      '--tmpfs',
      '/data',
      redisImage,
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
      '--requirepass',
      redisPassword,
    );
  const container = redisContainer(docker);
  const ports = container?.NetworkSettings.Ports?.['6379/tcp'];
  requireTest(
    container?.State.Running &&
      ports?.length === 1 &&
      ports[0].HostIp === host &&
      /^\d+$/.test(ports[0].HostPort),
    'Redis is not running on a loopback port',
  );
  for (let i = 0; i < 20; i++) {
    try {
      if (
        docker(
          'exec',
          container.Id,
          'redis-cli',
          '-a',
          redisPassword,
          'ping',
        ) === 'PONG'
      )
        return `redis://:${redisPassword}@${host}:${ports[0].HostPort}/0`;
    } catch {
      /* wait for Redis to initialize */
    }
    await delay(300);
  }
  throw new Error('Review Redis did not become ready');
}

function stopRedis(docker) {
  const container = redisContainer(docker);
  if (container?.State.Running) docker('stop', container.Id);
}

async function freePort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, host, resolve),
  );
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function waitForExit(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/PID', String(child.pid), '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else child.kill('SIGTERM');
}

async function probe(url, verify, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (await verify(res)) return;
    } catch {
      /* startup or dev compilation */
    }
    await delay(500);
  }
  throw new Error(`Readiness failed for ${url}`);
}

function loadState() {
  if (!existsSync(statePath)) return null;
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  requireTest(
    state.project === project &&
      [state.control, state.api, state.shop].every((url) =>
        /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(url),
      ),
    'Unexpected Review Live state identity',
  );
  return state;
}

async function control(state, path, method = 'GET') {
  const result = await fetch(state.control + path, {
    method,
    headers: { authorization: `Bearer ${state.token}` },
    signal: AbortSignal.timeout(20000),
  });
  requireTest(result.ok, `Review Live control failed: ${result.status}`);
  return result.json();
}

async function serve(token) {
  requireTest(
    readFileSync(lock, 'utf8') === token,
    'Missing startup ownership',
  );
  let docker, backend, next, server;
  let startedEnvironment = false;
  let release;
  const stopped = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const envFiles = [
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
    ];
    requireTest(
      envFiles.every((name) => !existsSync(join(frontend, name))),
      'Review frontend has an ambient .env file. Isolate it before starting.',
    );
    requireTest(
      !existsSync(join(runtime, '.env')),
      'Runtime directory contains .env',
    );
    docker = dockerCli();
    startedEnvironment = true;
    run(['infra/integration/run.mjs', 'up']);
    run(['infra/integration/run.mjs', 'migrate']);
    const redisUrl = await startRedis(docker);
    const backendPort = await freePort();
    const frontendPort = await freePort();
    requireTest(backendPort !== frontendPort, 'Port allocation collision');
    const api = `http://${host}:${backendPort}`;
    const shop = `http://${host}:${frontendPort}`;
    const jwt = randomBytes(40).toString('hex');
    const nextEnv = {
      ...envBase(),
      NODE_ENV: 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SERVER_URL: api,
      BACKEND_URL: api,
      API_URL: api,
      SERVER_URL: api,
      JWT_SECRET: jwt,
    };
    let seeded;
    await withServices(async (services) => {
      const local = 'review-live-test';
      Object.assign(process.env, {
        NODE_ENV: 'test',
        TS_NODE_PROJECT: join(root, 'tsconfig.json'),
        POSTGRES_URI: services.databaseUrl,
        QDRANT_URL: services.qdrantUrl,
        REDIS_URL: redisUrl,
        REDIS_URI: redisUrl,
        REDIS_HOST: host,
        REDIS_PORT: new URL(redisUrl).port,
        CLIENT_URL: shop,
        SERVER_URL: api,
        ALLOWED_ORIGIN: shop,
        JWT_SECRET: jwt,
        JWT_ACCESS_SECRET: jwt,
        JWT_REFRESH_SECRET: randomBytes(40).toString('hex'),
        SESSION_SECRET: randomBytes(40).toString('hex'),
        MAIL_HOST: host,
        MAIL_PORT: '1',
        MAIL_LOGIN: local,
        MAIL_PASSWORD: local,
        EMAIL_FROM: 'review-live@invalid.test',
        S3_ENDPOINT: `http://${host}:1`,
        S3_REGION: 'local',
        S3_ACCESS_KEY_ID: local,
        S3_SECRET_ACCESS_KEY: local,
        S3_BUCKET_NAME: local,
        YANDEX_CLIENT_ID: local,
        YANDEX_CLIENT_SECRET: local,
        VK_CLIENT_ID: local,
        VK_CLIENT_SECRET: local,
        EMBEDDING_PROVIDER: 'yandex',
        REVIEW_INDEX_ENABLED: 'true',
        REVIEW_SUMMARY_ENABLED: 'true',
        REVIEW_LIVE_AI_MODE: 'deterministic',
      });
      backend = await require('./live/backend.cjs').startBackend(services, {
        redisUrl,
        backendPort,
        controlToken: token,
      });
      seeded = backend.seeded;
    });
    requireTest(
      seeded.summary && seeded.products[0]?.ratingCount >= 10,
      'Missing seeded review corpus',
    );
    const fd = openSync(logPath, 'a');
    next = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'dev',
        '--hostname',
        host,
        '--port',
        String(frontendPort),
      ],
      {
        cwd: frontend,
        env: nextEnv,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      },
    );
    closeSync(fd);
    await probe(shop + '/catalog', (res) => res.ok);
    const publicState = { project, shop, api, seeded, ai: 'deterministic' };
    server = createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(403).end();
        return;
      }
      try {
        let body;
        if (req.url === '/ready' && req.method === 'GET') {
          const [health, page] = await Promise.all([
            fetch(api + '/__review-live/ready', {
              headers: { authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(5000),
            }),
            fetch(shop + '/catalog', { signal: AbortSignal.timeout(8000) }),
          ]);
          const healthy = health.ok && page.ok && next.exitCode === null;
          await Promise.all([health.body?.cancel(), page.body?.cancel()]);
          requireTest(
            healthy,
            'Review Live application or dependency is unhealthy',
          );
          body = publicState;
        } else if (req.url === '/seed' && req.method === 'POST') {
          const seededResponse = await fetch(api + '/__review-live/seed', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}` },
          });
          requireTest(seededResponse.ok, 'Seed command failed');
          body = await seededResponse.json();
          publicState.seeded = body;
        } else if (req.url === '/stop' && req.method === 'POST') {
          body = { stopping: true };
          res.once('finish', release);
        } else {
          res.writeHead(404).end();
          return;
        }
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(body));
      } catch (error) {
        res.writeHead(503).end(JSON.stringify({ error: error.message }));
      }
    });
    await new Promise((resolve, reject) =>
      server.once('error', reject).listen(0, host, resolve),
    );
    writeFileSync(
      statePath,
      JSON.stringify({
        ...publicState,
        token,
        control: `http://${host}:${server.address().port}`,
      }),
    );
    next.once('exit', release);
    await stopped;
  } finally {
    server?.closeAllConnections();
    server?.close();
    waitForExit(next);
    try {
      await backend?.close();
    } finally {
      try {
        if (docker) stopRedis(docker);
        if (startedEnvironment) await lifecycle('stop');
      } finally {
        if (existsSync(statePath)) unlinkSync(statePath);
        if (existsSync(lock)) unlinkSync(lock);
      }
    }
  }
}

async function main() {
  const [action, owner, ...extra] = process.argv.slice(2);
  requireTest(
    !extra.length && (action === 'serve' || !owner),
    'Review Live does not accept endpoint overrides',
  );
  if (action === 'serve') return serve(owner);
  if (action === 'start') {
    const existing = loadState();
    if (existing) {
      console.log(await control(existing, '/ready'));
      return;
    }
    // Verify Docker context and Compose identity before spawning a detached helper.
    dockerCli();
    mkdirSync(runtime, { recursive: true });
    const token = randomBytes(32).toString('hex');
    writeFileSync(lock, token, { flag: 'wx' });
    const fd = openSync(logPath, 'w');
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), 'serve', token],
      {
        cwd: runtime,
        env: { ...envBase(), NODE_ENV: 'test' },
        detached: true,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      },
    );
    closeSync(fd);
    child.unref();
    const deadline = Date.now() + 135000;
    while (!existsSync(statePath) && existsSync(lock) && Date.now() < deadline)
      await delay(500);
    const state = loadState();
    requireTest(
      state?.token === token,
      `Review Live failed to start. Log: ${logPath}`,
    );
    console.log(await control(state, '/ready'));
    return;
  }
  if (action === 'reset' || action === 'stop') {
    const state = loadState();
    if (state) {
      await control(state, '/stop', 'POST');
      const deadline = Date.now() + 25000;
      while (existsSync(lock) && Date.now() < deadline) await delay(300);
      requireTest(!existsSync(lock), 'Review Live did not stop');
    } else
      requireTest(
        !existsSync(lock),
        'Review Live is starting. Inspect its log.',
      );
    if (action === 'reset') {
      stopRedis(dockerCli());
      await lifecycle('reset');
    }
    return;
  }
  const state = loadState();
  requireTest(state, 'Start Review Live first');
  if (action === 'ready') return console.log(await control(state, '/ready'));
  if (action === 'seed')
    return console.log(await control(state, '/seed', 'POST'));
  if (action === 'smoke' || action === 'browser') {
    const attested = await control(state, '/ready');
    requireTest(
      attested.project === project &&
        attested.api === state.api &&
        attested.shop === state.shop,
      'Review Live endpoints differ from the running supervisor',
    );
  }
  if (action === 'smoke') return require('./live/smoke.cjs').run(state);
  if (action === 'browser') {
    const result = spawnSync(
      process.execPath,
      [
        'node_modules/cypress/bin/cypress',
        'run',
        '--spec',
        'cypress/e2e/review-live.cy.ts',
        '--config',
        `baseUrl=${state.shop},screenshotsFolder=node_modules/.cache/review-live/screenshots,video=false,trashAssetsBeforeRuns=false`,
      ],
      { cwd: frontend, env: envBase(), windowsHide: true, stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    requireTest(
      result.status === 0,
      `Review Live browser failed (${result.status})`,
    );
    return;
  }
  throw new Error(
    'Usage: npm run review:live -- <start|ready|seed|smoke|browser|stop|reset>',
  );
}

main().catch((error) => {
  console.error('Review Live:', error.message);
  process.exitCode = 1;
});
