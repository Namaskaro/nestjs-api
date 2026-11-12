import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { withServices } from './environment.mjs';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { Prisma, PrismaClient } = require('../../prisma/generated');
const { createPostgresMemoryRuntime } = require('../../src/consultation-memory/postgres-memory-runtime');
const { MEMORY_DAY_MS: day } = require('../../src/consultation-memory/consultation-memory.core');

const initialTime = Date.UTC(2026, 0, 1);
const criterion = { attributeId: 'cpuVendor', operator: 'eq' };
const preference = { domainKey: 'WORKSTATION', preferenceKey: 'cpuVendor' };
const criteria = vendor => ({
  profileId: 'WORKSTATION', goalKey: 'rendering', set: [
    { ...criterion, value: vendor, unit: null },
    { attributeId: 'ramGb', operator: 'gte', value: 32, unit: 'GB' },
  ],
});

function fixture(runId) {
  assert.match(runId, /^[a-f0-9]{32}$/);
  const store = 'memory-restart-' + runId;
  const table = Prisma.raw('"memory_host_' + runId + '"');
  const key = (subjectKey, sourceKey, storeKey = store) => ({ storeKey, subjectKey, sourceKind: 'PC_TICKET', sourceKey });
  return {
    table, store,
    expiring: key('42', 'ticket/7'),
    corrected: key('43', 'ticket/7'),
    removed: key('44', 'ticket/7'),
    stranger: key('45', 'ticket/7'),
    otherStore: key('42', 'ticket/7', store + '-other'),
  };
}

function sourceAdapter(table) {
  const read = async (tx, key, lock = false) => {
    if (key.sourceKind !== 'PC_TICKET') return null;
    const rowLock = lock ? Prisma.sql`FOR UPDATE` : Prisma.empty;
    const [row] = await tx.$queryRaw`SELECT account, step, attempt, input, reply, intent FROM ${table}
      WHERE tenant = ${key.storeKey} AND account = ${key.subjectKey} AND ticket = ${key.sourceKey} ${rowLock}`;
    return row ?? null;
  };
  return {
    async state(tx, key, lock) {
      const row = await read(tx, key, lock);
      if (!row) return null;
      return { subjectKey: row.account, authorizedCustomer: true, assistantAvailable: true,
        inputSeq: row.step, handoffVersion: 0, attemptId: row.attempt, sourceMessageId: row.input,
        ...(row.intent ? { nextIntent: 'start_new' } : {}) };
    },
    async input(tx, { key, sourceMessageId, inputSeq }) {
      const row = await read(tx, key);
      return row?.input === sourceMessageId && row.step === inputSeq ? {} : null;
    },
    async hasReply(tx, key, input, reply) {
      const row = await read(tx, key);
      return row?.input === input && Boolean(row.reply) && (!reply || row.reply === reply);
    },
    async markStartNew(tx, key, state) {
      await tx.$executeRaw`UPDATE ${table} SET intent = TRUE
        WHERE tenant = ${key.storeKey} AND account = ${key.subjectKey} AND ticket = ${key.sourceKey} AND step = ${state.inputSeq}`;
    },
    chatLink: () => null,
  };
}

async function persistTurn(prisma, table, key, step) {
  const attemptId = 'attempt/' + step;
  const sourceMessageId = 'request/' + step;
  const replyId = 'answer/' + step;
  await prisma.$executeRaw`INSERT INTO ${table} (tenant, account, ticket, step, attempt, input, reply)
    VALUES (${key.storeKey}, ${key.subjectKey}, ${key.sourceKey}, ${step}, ${attemptId}, ${sourceMessageId}, ${replyId})
    ON CONFLICT (tenant, account, ticket) DO UPDATE SET step = EXCLUDED.step, attempt = EXCLUDED.attempt,
      input = EXCLUDED.input, reply = EXCLUDED.reply, intent = FALSE`;
  return { admission: { key, sourceMessageId, inputSeq: step, handoffVersion: 0, attemptId }, replyId };
}

function confirmation(key, episode) {
  return { ...preference, commandId: randomUUID(), expectedRevision: 0, evidence: {
    sourceKind: key.sourceKind, sourceKey: key.sourceKey, episodeId: episode.id,
    episodeRevision: episode.revision, criterion,
  } };
}

async function seed(prisma, runtime, keys) {
  for (const [key, vendor] of [[keys.expiring, 'acme'], [keys.corrected, 'acme'],
    [keys.removed, 'acme'], [keys.otherStore, 'orbit']]) {
    const { admission, replyId } = await persistTurn(prisma, keys.table, key, 1);
    const basis = await runtime.memory.getBasis(admission);
    assert.ok(basis);
    assert.equal(await runtime.memory.project(basis, replyId, {
      sourceMessageId: admission.sourceMessageId,
      changes: [{ taskKey: 'workstation', kind: 'start', criteria: criteria(vendor) }],
    }), 'APPLIED');
    const [episode] = await runtime.memory.list(key);
    assert.equal((await runtime.userContext.confirm(key, confirmation(key, episode))).fact.value, vendor);
  }
  await persistTurn(prisma, keys.table, keys.stranger, 1);
  console.log('PC host seed: source, episode and confirmed fact committed in PostgreSQL (PID ' + process.pid + ')');
}

async function verify(prisma, { memory, userContext }, keys, setTime) {
  setTime(initialTime + 89 * day);
  const [episode] = await memory.list(keys.expiring);
  assert.equal(episode.status, 'PAUSED');
  assert.equal(episode.snapshot.goalKey, 'rendering');
  assert.equal(episode.snapshot.constraints[0].value, 'acme');
  const offer = await memory.getResumeOffer(keys.expiring);
  assert.equal(offer.expiresAt.getTime(), initialTime + 90 * day);
  assert.equal((await userContext.get(keys.expiring)).facts[0].source.episodeId, episode.id);
  assert.deepEqual(await memory.list(keys.stranger), []);
  assert.deepEqual(await userContext.get(keys.stranger), { revision: 0, facts: [] });
  await assert.rejects(memory.decideResumeOffer(keys.stranger, offer.offerId, 'continue'), { code: 'not_found' });
  await assert.rejects(memory.decideResumeOffer(keys.otherStore, offer.offerId, 'continue'), { code: 'not_found' });
  await assert.rejects(userContext.confirm(keys.otherStore, {
    ...confirmation(keys.expiring, episode), expectedRevision: 1,
  }), { code: 'not_found' });
  assert.equal((await memory.list(keys.otherStore))[0].snapshot.constraints[0].value, 'orbit');
  assert.equal((await userContext.get(keys.otherStore)).facts[0].value, 'orbit');

  const [corrected] = await memory.list(keys.corrected);
  await memory.correct(keys.corrected, corrected.id, corrected.revision, { criteria: { set: [{ ...criterion, value: 'zenith', unit: null }] } });
  assert.deepEqual(await userContext.get(keys.corrected), { revision: 2, facts: [] });
  const [removed] = await memory.list(keys.removed);
  await memory.remove(keys.removed, removed.id);
  assert.deepEqual(await memory.list(keys.removed), []);
  assert.deepEqual(await userContext.get(keys.removed), { revision: 2, facts: [] });

  setTime(initialTime + 90 * day);
  assert.deepEqual(await memory.list(keys.expiring), []);
  assert.equal(await memory.getResumeOffer(keys.expiring), null);
  await assert.rejects(memory.decideResumeOffer(keys.expiring, offer.offerId, 'continue'), { code: 'conflict' });
  assert.ok(await prisma.consultationEpisode.findUnique({ where: { id: episode.id } }));
  assert.equal(await memory.purgeExpired(keys.store), 1);
  assert.equal(await prisma.consultationEpisode.findUnique({ where: { id: episode.id } }), null);
  assert.equal((await userContext.get(keys.expiring)).facts[0].value, 'acme');
  assert.equal((await userContext.get(keys.otherStore)).facts[0].value, 'orbit');
  console.log('PC host restart: separate process read durable state, TTL 89/90, physical purge, revocation and isolation verified (PID ' + process.pid + ')');
}

async function runWorker(mode, runId) {
  assert.ok(['seed', 'verify', 'cleanup'].includes(mode));
  const keys = fixture(runId);
  await withServices(async ({ databaseUrl }) => {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      if (mode === 'cleanup') {
        const stores = [keys.store, keys.otherStore.storeKey];
        await prisma.userContextScope.deleteMany({ where: { storeKey: { in: stores } } });
        await prisma.consultationMemoryScope.deleteMany({ where: { storeKey: { in: stores } } });
        await prisma.$executeRaw`DROP TABLE IF EXISTS ${keys.table}`;
        return;
      }
      let time = initialTime;
      const runtime = createPostgresMemoryRuntime({
        prisma, source: sourceAdapter(keys.table), now: () => new Date(time), writeVersion: () => 2,
        preferencePolicy: (requested, evidence, field) =>
          requested.domainKey === preference.domainKey && requested.preferenceKey === preference.preferenceKey &&
          evidence.profileId === preference.domainKey && field.attributeId === criterion.attributeId && field.operator === criterion.operator
            ? evidence.criteria.find(item => item.attributeId === field.attributeId && item.operator === field.operator)?.value
            : undefined,
      });
      assert.ok(!Object.keys(require.cache).some(path => /[\\/](?:@nestjs|next-shop-memory\.adapter)[\\/.]/i.test(path)));
      if (mode === 'seed') {
        await prisma.$executeRaw`CREATE TABLE ${keys.table} (
          tenant TEXT NOT NULL, account TEXT NOT NULL, ticket TEXT NOT NULL, step INTEGER NOT NULL,
          attempt TEXT NOT NULL, input TEXT NOT NULL, reply TEXT NOT NULL, intent BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY (tenant, account, ticket))`;
        await seed(prisma, runtime, keys);
      } else {
        await verify(prisma, runtime, keys, value => { time = value; });
      }
    } finally {
      await prisma.$disconnect();
    }
  });
}

const [mode, runId] = process.argv.slice(2);
if (mode) {
  await runWorker(mode, runId);
} else {
  const id = randomUUID().replaceAll('-', '');
  const run = phase => {
    const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), phase, id], { stdio: 'inherit', timeout: 60000 });
    if (worker.error) throw worker.error;
    assert.equal(worker.status, 0, 'Host process ' + phase + ' failed');
  };
  try {
    run('seed');
    run('verify');
  } finally {
    run('cleanup');
  }
}
