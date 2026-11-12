import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const ownerPath = process.platform === 'win32' ? root.toLowerCase() : root;
export const project = `support-engine-it-${createHash('sha256').update(ownerPath).digest('hex').slice(0, 12)}`;
const network = `${project}_test`;
const host = '127.0.0.1';
const database = 'support_engine_it';
const testKey = `${project}_local_only`;
const projectLabel = 'com.docker.compose.project';
const services = {
  postgres: {
    port: '5432/tcp', volume: 'pgdata', destination: '/var/lib/postgresql/data',
    image: 'pgvector/pgvector@sha256:18d16372b8406bb38a9f94cbff15d125c463d71fde2770aa8b5c64bfcc1578ee',
    env: { POSTGRES_DB: database, POSTGRES_USER: database, POSTGRES_PASSWORD: testKey },
  },
  qdrant: {
    port: '6333/tcp', volume: 'qdrantdata', destination: '/qdrant/storage',
    image: 'qdrant/qdrant:v1.19.0@sha256:057ee3a8da769fe7310dd3537b4dc7583bf87a95ce8ac43c0af5a46bc580d1fc',
    env: { QDRANT__SERVICE__API_KEY: testKey },
  },
};

export function requireTest(condition, message) {
  if (!condition) throw new Error(message);
}

export function dockerCli() {
  requireTest(!process.env.NODE_ENV || process.env.NODE_ENV === 'test', 'NODE_ENV must be unset or test');
  requireTest(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT,
    'Unset DOCKER_HOST and DOCKER_CONTEXT. Select a local context using docker context use.');
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(COMPOSE_|SUPPORT_ENGINE_IT_KEY$|DOCKER_(HOST|CONTEXT|TLS|TLS_VERIFY|CERT_PATH|API_VERSION)$)/i.test(key)));
  env.SUPPORT_ENGINE_IT_KEY = testKey;
  const run = (args) => {
    const result = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
    if (result.error) throw result.error;
    requireTest(result.status === 0, result.stderr?.trim() || `Docker exited with status ${result.status}`);
    return result.stdout.trim();
  };
  const context = run(['context', 'show']);
  const endpoint = run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', context]);
  requireTest(/^npipe:\/\/\/\/\.\/pipe\/[\w.-]+$|^unix:\/\/\/[^\s]+$/i.test(endpoint),
    'The Docker context must use a local Windows pipe or Unix socket');
  const docker = (...args) => run(['--context', context, ...args]);
  const version = docker('version', '--format', '{{.Server.Version}}');
  requireTest(Number(version.split('.')[0]) >= 28, 'Docker Engine 28+ is required for localhost port isolation');
  return docker;
}

function compose(docker, ...args) {
  return docker('compose', '--project-directory', root, '--env-file', 'infra/integration/compose.env',
    '--project-name', project, '--file', 'infra/integration/compose.yaml', ...args);
}

function lines(output) {
  return output ? output.split(/\r?\n/) : [];
}

function inspect(docker, type, ids) {
  return ids.length ? JSON.parse(docker(type, 'inspect', ...ids)) : [];
}

function attestProject(docker) {
  const owned = `label=${projectLabel}=${project}`;
  const names = Object.keys(services).map((service) => `${project}-${service}-1`);
  const ids = new Set(lines(docker('ps', '-aq', '--no-trunc', '--filter', owned)));
  const containersByName = lines(docker('ps', '-a', '--no-trunc', '--format', '{{.ID}} {{.Names}}'));
  for (const line of containersByName) {
    const [id, name] = line.split(' ');
    if (names.includes(name)) ids.add(id);
  }
  const containers = {};
  for (const container of inspect(docker, 'container', [...ids])) {
    const labels = container.Config.Labels;
    const name = labels?.['com.docker.compose.service'];
    const expected = Object.hasOwn(services, name) && services[name];
    requireTest(expected && labels[projectLabel] === project && container.Name === `/${project}-${name}-1` &&
      container.Config.Image === expected.image, `Unexpected container in ${project}: ${container.Name}`);

    const mounts = container.Mounts;
    requireTest(mounts.length === 1 && mounts[0].Type === 'volume' && mounts[0].RW &&
      mounts[0].Name === `${project}_${expected.volume}` && mounts[0].Destination === expected.destination,
    `Unexpected data mount for ${name}`);
    const bindings = container.HostConfig.PortBindings;
    requireTest(Object.keys(bindings ?? {}).length === 1 && bindings[expected.port]?.length === 1 &&
      bindings[expected.port][0].HostIp === host && ['', '0'].includes(bindings[expected.port][0].HostPort),
    `Unexpected configured port for ${name}`);
    requireTest(Object.keys(container.NetworkSettings.Networks).join() === network &&
      Object.entries(expected.env).every(([key, value]) => container.Config.Env.includes(`${key}=${value}`)),
    `Unexpected network or environment for ${name}`);
    containers[name] = container;
  }

  const volumeNames = Object.values(services).map(({ volume }) => `${project}_${volume}`);
  const volumeIds = new Set(lines(docker('volume', 'ls', '-q', '--filter', owned)));
  for (const name of lines(docker('volume', 'ls', '-q'))) {
    if (volumeNames.includes(name)) volumeIds.add(name);
  }
  for (const volume of inspect(docker, 'volume', [...volumeIds])) {
    const key = volume.Labels?.['com.docker.compose.volume'];
    requireTest(volumeNames.includes(volume.Name) && volume.Name === `${project}_${key}` &&
      volume.Labels[projectLabel] === project && volume.Driver === 'local' && !Object.keys(volume.Options ?? {}).length,
    `Unexpected volume in ${project}: ${volume.Name}`);
    const attached = lines(docker('ps', '-aq', '--no-trunc', '--filter', `volume=${volume.Name}`));
    requireTest(attached.every((id) => ids.has(id)), `An outside container uses ${volume.Name}`);
  }

  const networkIds = new Set(lines(docker('network', 'ls', '-q', '--no-trunc', '--filter', owned)));
  const existingNetworks = lines(docker('network', 'ls', '--no-trunc', '--format', '{{.ID}} {{.Name}}'));
  for (const line of existingNetworks) {
    const [id, name] = line.split(' ');
    if (name === network) networkIds.add(id);
  }
  for (const item of inspect(docker, 'network', [...networkIds])) {
    requireTest(item.Name === network && item.Labels?.[projectLabel] === project &&
      item.Labels['com.docker.compose.network'] === 'test' && item.Driver === 'bridge' &&
      Object.keys(item.Containers ?? {}).every((id) => ids.has(id)), `Unexpected network in ${project}: ${item.Name}`);
  }
  return { containers, empty: !ids.size && !volumeIds.size && !networkIds.size };
}

function publishedPort(container, service) {
  requireTest(container?.State.Health?.Status === 'healthy', `${service} is not healthy. Run integration up.`);
  const bindings = container.NetworkSettings.Ports;
  const mapping = bindings[services[service].port];
  requireTest(mapping?.length === 1 && mapping[0].HostIp === host && /^\d+$/.test(mapping[0].HostPort) &&
    Number(mapping[0].HostPort) > 0 && Number(mapping[0].HostPort) <= 65535 &&
    Object.values(bindings).filter(Boolean).length === 1, `Unexpected published address for ${service}`);
  return mapping[0].HostPort;
}

async function useServices(docker, callback) {
  const { containers } = attestProject(docker);
  const pgPort = publishedPort(containers.postgres, 'postgres');
  const qdrantPort = publishedPort(containers.qdrant, 'qdrant');
  requireTest(pgPort !== qdrantPort, 'PostgreSQL and Qdrant must have distinct published ports');
  const databaseUrl = `postgresql://${database}:${testKey}@${host}:${pgPort}/${database}`;
  const qdrantUrl = `http://${host}:${qdrantPort}`;
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, connectionTimeoutMillis: 5000,
    statement_timeout: 10000, options: '-c search_path=public' });
  const identitySql = `SELECT current_database() AS db, current_user AS role,
    current_setting('server_version_num')::int AS version, system_identifier::text AS id FROM pg_control_system()`;
  const request = (method, path, body, key) => {
    requireTest(path.startsWith('/') && !path.startsWith('//'), 'Qdrant requires a relative API path');
    return new Promise((resolve, reject) => {
      // An explicit direct agent bypasses ambient HTTP proxies. node:http does not follow redirects.
      const req = httpRequest({ hostname: host, port: qdrantPort, path, method, agent: false,
        signal: AbortSignal.timeout(10000), headers: { 'api-key': key, 'content-type': 'application/json' } },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, text }));
        response.on('error', reject);
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  };
  const qdrant = async (method, path, body) => {
    const { status, text } = await request(method, path, body, testKey);
    if (status < 200 || status >= 300) {
      throw Object.assign(new Error(`Qdrant ${method} ${path} returned ${status}: ${text}`), { status });
    }
    return JSON.parse(text);
  };

  try {
    const inside = docker('exec', containers.postgres.Id, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1',
      '-U', database, '-d', database, '-c', `SELECT row_to_json(identity) FROM (${identitySql}) identity`);
    const expected = JSON.parse(inside);
    const { rows: [actual] } = await pool.query(identitySql);
    requireTest(expected.db === database && expected.role === database && /^\d+$/.test(expected.id) &&
      actual.db === database && actual.role === database && actual.id === expected.id &&
      actual.version === expected.version && Math.floor(actual.version / 10000) === 15,
    'The published PostgreSQL endpoint does not match the test container and database');
    const unauthorized = await request('GET', '/collections', undefined, 'invalid-test-key');
    requireTest([401, 403].includes(unauthorized.status), 'Qdrant did not reject an invalid test key');
    requireTest((await qdrant('GET', '/')).version === '1.19.0' &&
      Array.isArray((await qdrant('GET', '/collections')).result.collections), 'Unexpected Qdrant identity or response');
    return await callback({ project, databaseUrl, qdrantUrl, qdrantApiKey: testKey, pool, qdrant,
      postgresVersion: actual.version });
  } finally {
    await pool.end();
  }
}

export function withServices(callback) {
  return useServices(dockerCli(), callback);
}

export async function lifecycle(action) {
  const docker = dockerCli();
  const { containers, empty } = attestProject(docker);
  if (action === 'stop') {
    const running = Object.values(containers).filter((container) => container.State.Running);
    if (running.length) docker('stop', ...running.map((container) => container.Id));
    console.log(`${project}: stopped; volumes retained`);
    return;
  }
  if (action === 'reset') {
    if (empty) {
      console.log(`${project}: nothing to reset`);
      return;
    }
    requireTest(containers.postgres && containers.qdrant, 'Reset refused: incomplete test project');
  }
  compose(docker, 'up', '-d', '--wait', '--wait-timeout', '90', '--no-recreate');
  await useServices(docker, ({ project, databaseUrl, qdrantUrl, postgresVersion }) => {
    console.log(`${project}: PostgreSQL ${postgresVersion} at ${new URL(databaseUrl).host}/${database}; Qdrant at ${qdrantUrl}`);
  });
  if (action === 'reset') {
    attestProject(docker);
    compose(docker, 'down', '--volumes');
    requireTest(attestProject(docker).empty, 'Some test resources remain after reset');
    console.log(`${project}: containers, network and test volumes removed`);
  }
}
