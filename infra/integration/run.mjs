import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { lifecycle, requireTest, root, withServices } from './environment.mjs';
import { checkFixtures, checkServiceContract, prepareCollections, seedFixtures } from './fixtures.mjs';

const prismaDirectory = join(root, 'prisma');
const migrationsDirectory = join(prismaDirectory, 'migrations');
const schema = join(prismaDirectory, 'schema.prisma');
const require = createRequire(import.meta.url);

function migrate(databaseUrl) {
  const source = readFileSync(schema, 'utf8').replace(/\/\/[^\r\n]*/g, '');
  const [datasource, ...others] = [...source.matchAll(/\bdatasource\s+\w+\s*\{([^}]+)\}/g)];
  requireTest(datasource && !others.length && /\bprovider\s*=\s*"postgresql"/.test(datasource[1]) &&
    /\burl\s*=\s*env\(\s*"POSTGRES_URI"\s*\)/.test(datasource[1]) &&
    !/\b(?:directUrl|shadowDatabaseUrl)\s*=/.test(datasource[1]),
  'Expected one PostgreSQL datasource with url = env("POSTGRES_URI") and no alternate URLs');

  // Prisma 6 discovers dotenv files via cwd and schema location. Keep both away from the host project.
  const temporaryRoot = realpathSync(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'support-engine-prisma-'));
  requireTest(dirname(realpathSync(directory)) === temporaryRoot, 'Unexpected Prisma staging location');
  try {
    copyFileSync(schema, join(directory, 'schema.prisma'));
    cpSync(migrationsDirectory, join(directory, 'migrations'), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => /^(SystemRoot|windir|TEMP|TMP|TMPDIR|PATH|USERPROFILE|HOME|LOCALAPPDATA|APPDATA)$/i.test(key)));
    const result = spawnSync(process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(directory, 'schema.prisma')], {
        cwd: directory,
        env: { ...env, NODE_ENV: 'test', POSTGRES_URI: databaseUrl, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
        stdio: 'inherit', windowsHide: true,
      });
    if (result.error) throw result.error;
    requireTest(result.status === 0, `Prisma migrate deploy failed (${result.status ?? result.signal})`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function verifyMigrations(pool, allowPending = false) {
  const names = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  requireTest(names.length, 'The worktree has no Prisma migrations');
  const { rows: [{ exists }] } = await pool.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists");
  if (allowPending && !exists) return;
  requireTest(exists, 'No Prisma migrations are applied. Run integration migrate.');
  const { rows } = await pool.query(`SELECT migration_name, checksum, finished_at FROM public._prisma_migrations
    WHERE rolled_back_at IS NULL ORDER BY migration_name`);
  const failed = rows.find(({ finished_at }) => !finished_at);
  requireTest(!failed, `Prisma migration ${failed?.migration_name} is unfinished. Inspect the original migration error.`);
  requireTest(rows.every(({ migration_name }, index) => migration_name === names[index]) &&
    (allowPending || rows.length === names.length),
    'Applied migrations differ from this worktree. Reset the test environment and migrate again.');

  for (const { migration_name, checksum } of rows) {
    const original = readFileSync(join(migrationsDirectory, migration_name, 'migration.sql'), 'utf8');
    const lf = original.replace(/\r\n/g, '\n');
    const hashes = [original, lf, lf.replace(/\n/g, '\r\n')]
      .map((sql) => createHash('sha256').update(sql).digest('hex'));
    requireTest(hashes.includes(checksum), `Checksum differs for applied migration ${migration_name}. Reset the test environment.`);
  }
  if (allowPending) return;
  const { rows: [vector] } = await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  console.log(`${names.length} Prisma migrations verified${vector ? `; pgvector ${vector.extversion}` : ''}`);
}

const actions = {
  ready: ({ project, databaseUrl, qdrantUrl, postgresVersion }) => {
    const { host, pathname } = new URL(databaseUrl);
    console.log(`${project}: PostgreSQL ${postgresVersion} at ${host}${pathname}; Qdrant at ${qdrantUrl}`);
  },
  migrate: async ({ pool, databaseUrl }) => {
    await verifyMigrations(pool, true);
    migrate(databaseUrl);
    await verifyMigrations(pool);
  },
  collections: async ({ qdrant }) => {
    await prepareCollections(qdrant);
    console.log('Qdrant integration collections verified');
  },
  seed: async ({ pool, qdrant }) => {
    await verifyMigrations(pool);
    await seedFixtures(pool, qdrant);
    console.log('Synthetic Support Engine fixtures seeded');
  },
  test: async ({ pool, qdrant }) => {
    await verifyMigrations(pool);
    await checkFixtures(pool, qdrant);
    console.log('Support Engine PostgreSQL and Qdrant checks passed');
  },
  contract: async ({ pool, qdrant }) => {
    await checkServiceContract(pool, qdrant);
    console.log('PostgreSQL and Qdrant service contracts passed');
  },
};

try {
  const [action, ...extra] = process.argv.slice(2);
  requireTest(!extra.length, 'Integration commands do not accept endpoint overrides or extra arguments');
  if (['up', 'stop', 'reset'].includes(action)) await lifecycle(action);
  else {
    requireTest(Object.hasOwn(actions, action),
      'Usage: npm run integration -- <up|ready|migrate|collections|seed|test|contract|stop|reset>');
    await withServices(actions[action]);
  }
} catch (error) {
  console.error(`Integration environment: ${error.message}`);
  process.exitCode = 1;
}
