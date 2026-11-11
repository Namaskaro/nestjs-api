
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { withServices } from './environment.mjs';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { PrismaClient } = require('../../prisma/generated');
const { ConsultationMemory } = require('../../src/consultation-memory/consultation-memory.application');
const { NextShopMemorySource, nextShopMemoryKey } = require('../../src/consultation-memory/next-shop-memory.adapter');
const { UserContext, revokeEpisodePreferences } = require('../../src/user-context/user-context.application');
const { PrismaUserContextRepository } = require('../../src/user-context/prisma-user-context.repository');
const { nextShopPreferencePolicy } = require('../../src/user-context/next-shop-user-context.adapter');
const { PrismaMemoryRepository } = require('../../src/consultation-memory/prisma-memory.repository');
const { MEMORY_DAY_MS: day } = require('../../src/consultation-memory/consultation-memory.core');
const runId = randomUUID();

function commerce(prisma) {
  const owners = [];
  const storeKey = 'portable-nextshop-' + runId;
  return {
    name: 'NextShop',
    preferencePolicy: nextShopPreferencePolicy,
    version: 1,
    source: new NextShopMemorySource(),
    criteria: { profileId: 'SHOES', set: [
      { attributeId: 'color', operator: 'eq', value: 'синий', unit: null },
      { attributeId: 'price', operator: 'lte', value: 6000, unit: null },
    ] },
    async account() {
      const user = await prisma.user.create({ data: { role: 'Client', email: randomUUID() + '@example.invalid' } });
      owners.push(user.id);
      const chat = await prisma.chat.create({ data: { userId: user.id } });
      const key = nextShopMemoryKey(storeKey, user.id, chat.id);
      return key;
    },
    async turn(key, offerId) {
      return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Chat" WHERE id = ${key.sourceKey} FOR UPDATE`;
        const attemptId = randomUUID();
        const chat = await tx.chat.update({
          where: { id: key.sourceKey }, data: { consultationInputSeq: { increment: 1 }, consultationAttemptId: attemptId },
        });
        const input = await tx.message.create({ data: {
          chatId: chat.id, authorId: key.subjectKey, role: 'USER', content: 'Synthetic consultation',
          consultationInputSeq: chat.consultationInputSeq, ...(offerId ? { payload: { consultationContinuationOfferId: offerId } } : {}),
        } });
        await tx.chat.update({ where: { id: chat.id }, data: { consultationSourceMessageId: input.id } });
        const reply = await tx.message.create({ data: {
          chatId: chat.id, role: 'ASSISTANT', content: 'Synthetic answer', assistantSourceMessageId: input.id,
          expectsEpisodeProjection: true,
        } });
        return { admission: { key, sourceMessageId: input.id, inputSeq: chat.consultationInputSeq,
          attemptId, handoffVersion: chat.handoffVersion }, replyId: reply.id };
      });
    },
    async cleanup() {
      await prisma.userContextScope.deleteMany({ where: { storeKey } });
      await prisma.consultationMemoryScope.deleteMany({ where: { storeKey } });
      await prisma.user.deleteMany({ where: { id: { in: owners } } });
    },
  };
}

// External records deliberately do not use a NextShop User, Chat, Message or SearchSpec.
function computer(prisma) {
  const external = new Map();
  let serial = 46000;
  const storeKey = 'portable-pc-' + runId;
  const recordsFor = key => key.storeKey === storeKey && key.sourceKind === 'PC_TICKET'
    ? external.get(key.sourceKey) : undefined;
  const catalogue = [
    { sku: 'pc-01', maker: 'acme', ram: 32, goodFor: 'rendering', compatible: true },
    { sku: 'pc-02', maker: 'acme', ram: 16, goodFor: 'office', compatible: true },
    { sku: 'pc-03', maker: 'acme', ram: 32, goodFor: 'rendering', compatible: false },
  ];
  return {
    name: 'Synthetic PC catalogue',
    preferencePolicy: (preference, evidence, criterion) => {
      if (preference.domainKey !== 'WORKSTATION' || evidence.profileId !== preference.domainKey ||
          preference.preferenceKey !== 'cpuVendor' || criterion.attributeId !== 'cpuVendor' || criterion.operator !== 'eq') return undefined;
      return evidence.criteria.find(item => item.attributeId === criterion.attributeId && item.operator === criterion.operator)?.value;
    },
    version: 2,
    source: {
      async state(tx, key, lock) {
        if (lock) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key.storeKey + '/' + key.sourceKey}, 0))`;
        const ticket = recordsFor(key);
        if (!ticket) return null;
        return {
          subjectKey: String(ticket.accountNo), authorizedCustomer: true, assistantAvailable: true,
          inputSeq: ticket.step, handoffVersion: 0, attemptId: ticket.requestRef, sourceMessageId: ticket.inputRef,
        };
      },
      async input(_tx, admission) {
        const ticket = recordsFor(admission.key);
        return ticket?.inputRef === admission.sourceMessageId && ticket.step === admission.inputSeq &&
          String(ticket.accountNo) === admission.key.subjectKey ? { offerId: ticket.resumeRef } : null;
      },
      async hasReply(_tx, key, inputId, replyId) {
        const ticket = recordsFor(key);
        return ticket?.inputRef === inputId && Boolean(ticket.answerRef) && (!replyId || ticket.answerRef === replyId);
      },
      chatLink() { return null; },
    },
    criteria: { profileId: 'WORKSTATION', goalKey: 'rendering', set: [
      { attributeId: 'cpuVendor', operator: 'eq', value: 'acme', unit: null },
      { attributeId: 'ramGb', operator: 'gte', value: 32, unit: 'GB' },
      { attributeId: 'componentCompatibility', operator: 'eq', value: true, unit: null },
    ] },
    async account() {
      const accountNo = ++serial;
      const sourceKey = 'ticket/' + accountNo;
      external.set(sourceKey, { accountNo, step: 0, inputRef: null, requestRef: null });
      return { storeKey, subjectKey: String(accountNo), sourceKind: 'PC_TICKET', sourceKey };
    },
    async turn(key, offerId) {
      const ticket = recordsFor(key);
      ticket.step++;
      ticket.requestRef = 'command/' + randomUUID();
      ticket.inputRef = 'customer-entry/' + ticket.step;
      ticket.answerRef = 'assistant-entry/' + ticket.step;
      ticket.resumeRef = offerId;
      return {
        admission: { key, sourceMessageId: ticket.inputRef, inputSeq: ticket.step, attemptId: ticket.requestRef, handoffVersion: 0 },
        replyId: ticket.answerRef,
      };
    },
    search(snapshot) {
      const values = Object.fromEntries(snapshot.constraints.map(({ attributeId, value }) => [attributeId, value]));
      assert.equal(values.componentCompatibility, true);
      return catalogue.filter(item => item.maker === values.cpuVendor && item.ram >= values.ramGb &&
        item.goodFor === snapshot.goalKey && item.compatible === values.componentCompatibility).map(item => item.sku);
    },
    async cleanup() {
      await prisma.userContextScope.deleteMany({ where: { storeKey } });
      await prisma.consultationMemoryScope.deleteMany({ where: { storeKey } });
    },
  };
}

async function runContract(prisma, second, adapter) {
  const key = await adapter.account();
  const stranger = await adapter.account();
  const repository = new PrismaMemoryRepository(prisma, adapter.source);
  const secondRepository = new PrismaMemoryRepository(second, adapter.source);
  let now = Date.now();
  const nowClock = () => new Date(now);
  const hash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const memory = new ConsultationMemory(repository, nowClock, hash, () => adapter.version);
  const otherConnection = new ConsultationMemory(secondRepository, nowClock, hash, () => adapter.version);
  const first = await adapter.turn(key);
  const basis = await memory.getBasis(first.admission);
  assert.ok(basis);
  const candidate = { sourceMessageId: basis.sourceMessageId, changes: [{ taskKey: 'task', kind: 'start', criteria: adapter.criteria }] };
  const writes = await Promise.all([memory, otherConnection].map(service => service.project(basis, first.replyId, candidate)));
  assert.deepEqual(writes.sort(), ['APPLIED', 'DUPLICATE']);
  const [saved] = await memory.list(key);
  assert.equal(saved.snapshot.constraints.length, adapter.criteria.set.length);
  assert.equal(saved.snapshot.goalKey, adapter.criteria.goalKey);
  assert.equal(await memory.getResumeOffer(key), null);
  assert.equal(await memory.getResumeOffer({ ...key, subjectKey: stranger.subjectKey }), null);
  assert.equal(await memory.getResumeOffer({ ...key, storeKey: 'different-' + runId }), null);
  assert.equal(await memory.getBasis({ ...first.admission, sourceMessageId: 'missing-source' }), null);

  now += 7 * day;
  const offer = await memory.getResumeOffer(key);
  assert.ok(offer);
  assert.equal((await memory.decideResumeOffer(key, offer.offerId, 'continue')).decision, 'continue');
  const consume = (service, repo) => repo.transaction(unit => service.consumeResumeOffer(unit, key, offer.offerId));
  const consumed = await Promise.allSettled([consume(memory, repository), consume(otherConnection, secondRepository)]);
  assert.equal(consumed.filter(result => result.status === 'fulfilled').length, 1);
  const continuation = consumed.find(result => result.status === 'fulfilled').value;
  if (adapter.search) assert.deepEqual(adapter.search(continuation.snapshot), ['pc-01']);
  const turn = await adapter.turn(key, offer.offerId);
  const resumed = await memory.getBasis(turn.admission);
  assert.equal(resumed.continuation.episodeId, saved.id);
  assert.equal(await memory.project(resumed, turn.replyId, { sourceMessageId: resumed.sourceMessageId, changes: [
    { taskKey: 'task', kind: 'update', outcome: 'FINISHED_UNSPECIFIED' },
  ] }), 'APPLIED');
  const [closed] = await memory.list(key);
  assert.equal(closed.status, 'CLOSED');
  const [stored] = await prisma.consultationEpisode.findMany({
    where: { id: saved.id }, select: { schemaVersion: true, scope: { select: { chatId: true } } },
  });
  assert.equal(stored.schemaVersion, adapter.version);
  if (adapter.version === 2) assert.equal(stored.scope.chatId, null);
  const upgradedWriter = new ConsultationMemory(repository, nowClock, hash, () => 2);
  const corrected = await upgradedWriter.correct(key, closed.id, closed.revision, { criteria: { clear: [
    { attributeId: adapter.criteria.set[0].attributeId, operator: adapter.criteria.set[0].operator },
  ] } });
  assert.equal(corrected.snapshot.constraints.length, adapter.criteria.set.length - 1);
  assert.equal((await prisma.consultationEpisode.findUnique({ where: { id: closed.id } })).schemaVersion, 2);
  assert.deepEqual((await memory.list(key))[0].snapshot, corrected.snapshot);
  await memory.remove(key, closed.id);
  assert.deepEqual(await memory.list(key), []);
  assert.equal(await memory.project(resumed, turn.replyId, { sourceMessageId: resumed.sourceMessageId, changes: [
    { taskKey: 'task', kind: 'start', criteria: adapter.criteria },
  ] }), 'STALE');

  const expiry = await adapter.turn(key);
  const expiryBasis = await memory.getBasis(expiry.admission);
  assert.equal(await memory.project(expiryBasis, expiry.replyId, { sourceMessageId: expiryBasis.sourceMessageId, changes: [
    { taskKey: 'expires', kind: 'start', criteria: adapter.criteria },
  ] }), 'APPLIED');
  now += 14 * day;
  assert.equal((await memory.list(key))[0].status, 'PAUSED');
  now += 76 * day;
  assert.deepEqual(await memory.list(key), []);
  assert.equal(await memory.purgeExpired(key.storeKey), 1);
  console.log(adapter.name + ': same ConsultationMemory contract on PostgreSQL, snapshot v' + adapter.version);
}


async function runUserContextContract(prisma, second, adapter) {
  const key = await adapter.account();
  const stranger = await adapter.account();
  let now = Date.now();
  const clock = () => new Date(now);
  const build = client => {
    const memoryStorage = new PrismaMemoryRepository(client, adapter.source);
    const contextStorage = new PrismaUserContextRepository(client, memoryStorage);
    const repository = new PrismaMemoryRepository(client, adapter.source, (tx, owner, episodeId, changed) =>
      revokeEpisodePreferences(contextStorage.bind(tx), owner, {
        sourceKind: owner.sourceKind, sourceKey: owner.sourceKey, episodeId,
      }, changed));
    return {
      memory: new ConsultationMemory(repository, clock, payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        () => adapter.version),
      context: new UserContext(contextStorage, clock, adapter.preferencePolicy),
      storage: contextStorage,
    };
  };
  const { memory, context, storage } = build(prisma);
  const other = build(second);
  const chosen = adapter.criteria.set[0];
  const unrelated = adapter.criteria.set[1];
  const preference = { domainKey: adapter.criteria.profileId, preferenceKey: chosen.attributeId };
  const seed = async (taskKey, value = chosen.value) => {
    const turn = await adapter.turn(key);
    const basis = await memory.getBasis(turn.admission);
    assert.ok(basis);
    const criteria = { ...adapter.criteria, set: adapter.criteria.set.map(item => item === chosen ? { ...item, value } : item) };
    assert.equal(await memory.project(basis, turn.replyId, { sourceMessageId: basis.sourceMessageId, changes: [
      { taskKey, kind: 'start', criteria },
    ] }), 'APPLIED');
    return (await memory.list(key)).find(episode => episode.taskKey === taskKey);
  };
  const command = (episode, expectedRevision, fields = chosen) => ({
    ...preference, commandId: randomUUID(), expectedRevision,
    evidence: {
      sourceKind: key.sourceKind, sourceKey: key.sourceKey, episodeId: episode.id, episodeRevision: episode.revision,
      criterion: { attributeId: fields.attributeId, operator: fields.operator },
    },
  });

  const first = await seed('preference-source');
  assert.deepEqual(await context.get(key), { revision: 0, facts: [] });
  await assert.rejects(context.confirm(key, {
    ...command(first, 0, unrelated), preferenceKey: unrelated.attributeId,
  }), { code: 'unsupported' });
  await assert.rejects(context.confirm(stranger, command(first, 0)), { code: 'not_found' });
  await assert.rejects(context.confirm({ ...key, storeKey: key.storeKey + '-other' }, command(first, 0)), { code: 'not_found' });

  const failAfterWrite = new UserContext({
    transaction: operation => storage.transaction(unit => operation({
      ...unit,
      save: async (...args) => {
        await unit.save(...args);
        throw new Error('Synthetic storage failure after write');
      },
    })),
  }, clock, adapter.preferencePolicy);
  await assert.rejects(failAfterWrite.confirm(key, command(first, 0)), /Synthetic storage failure/);
  assert.deepEqual(await context.get(key), { revision: 0, facts: [] });
  assert.equal((await memory.list(key)).find(item => item.id === first.id).revision, first.revision);

  const update = command(first, 0);
  const [saved, replay] = await Promise.all([context.confirm(key, update), other.context.confirm(key, update)]);
  assert.deepEqual(saved, replay);
  assert.equal(saved.revision, 1);
  assert.equal(saved.fact.value, chosen.value);
  assert.deepEqual(saved.fact.source, update.evidence);
  assert.equal(saved.fact.confirmation, 'CONFIRMED');
  assert.equal((await context.get(key)).facts.length, 1);
  assert.deepEqual(await context.get(stranger), { revision: 0, facts: [] });

  const newer = await seed('replacement-source', 'replacement');
  const replacement = await context.confirm(key, command(newer, 1));
  assert.equal(replacement.fact.value, 'replacement');
  assert.equal(replacement.revision, 2);
  await memory.remove(key, first.id);
  assert.equal((await context.get(key)).facts[0].source.episodeId, newer.id);
  const correctedUnrelated = await memory.correct(key, newer.id, newer.revision, { criteria: { clear: [
    { attributeId: unrelated.attributeId, operator: unrelated.operator },
  ] } });
  assert.equal((await context.get(key)).revision, 2);
  await memory.correct(key, newer.id, correctedUnrelated.revision, { criteria: { clear: [
    { attributeId: chosen.attributeId, operator: chosen.operator },
  ] } });
  assert.deepEqual(await context.get(key), { revision: 3, facts: [] });

  const toRemove = await seed('race-source');
  const racing = command(toRemove, 3);
  const results = await Promise.allSettled([other.context.confirm(key, racing), memory.remove(key, toRemove.id)]);
  assert.equal(results[1].status, 'fulfilled');
  assert.deepEqual((await context.get(key)).facts, []);

  const toExpire = await seed('expiry-source');
  const live = await context.get(key);
  const expiringCommand = command(toExpire, live.revision);
  const expiring = await context.confirm(key, expiringCommand);
  now += 90 * day;
  assert.equal(await memory.purgeExpired(key.storeKey) >= 1, true);
  assert.equal((await context.get(key)).facts[0].source.episodeId, toExpire.id);
  assert.deepEqual(await context.confirm(key, expiringCommand), expiring);
  await context.remove(key, expiring.revision);
  assert.deepEqual(await context.get(key), { revision: expiring.revision + 1, facts: [] });
  await assert.rejects(context.confirm(key, expiringCommand), { code: 'conflict' });

  const afterErasure = await seed('after-erasure');
  const erased = await context.get(key);
  const concurrent = command(afterErasure, erased.revision);
  const race = await Promise.allSettled([other.context.confirm(key, concurrent), context.remove(key, erased.revision)]);
  assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
  const final = await context.get(key);
  if (final.facts.length) await context.remove(key, final.revision, preference);
  assert.deepEqual((await context.get(key)).facts, []);
  assert.ok((await memory.list(key)).some(episode => episode.id === afterErasure.id));
  console.log(adapter.name + ': same UserContext contract on PostgreSQL, explicit confirmation, expiry, rollback, races and revocation');
}

await withServices(async ({ databaseUrl }) => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const second = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    for (const adapter of [commerce(prisma), computer(prisma)]) {
      try {
        await runContract(prisma, second, adapter);
        await runUserContextContract(prisma, second, adapter);
      } finally {
        await adapter.cleanup();
      }
    }
  } finally {
    await Promise.all([prisma.$disconnect(), second.$disconnect()]);
  }
});
