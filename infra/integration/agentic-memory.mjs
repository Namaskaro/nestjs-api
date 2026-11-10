import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { withServices } from './environment.mjs';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { ChatGateway } = require('../../src/modules/chat/chat.gateway');
const { ChatService } = require('../../src/modules/chat/chat.service');
const { PrismaClient, Role } = require('../../prisma/generated');
const { ConsultationMemoryService } = require('../../src/consultation-memory/consultation-memory.service');
process.env.CONSULTATION_MEMORY_ENABLED = '1';
process.env.CONSULTATION_MEMORY_STORE_KEY = 'memory-it-' + randomUUID();

await withServices(async ({ databaseUrl }) => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const second = new PrismaClient({ datasourceUrl: databaseUrl });
  const ownerIds = [];
  const startTime = Date.UTC(2026, 0, 1);
  let now = startTime;
  const service = new ConsultationMemoryService(prisma, () => new Date(now));
  const other = new ConsultationMemoryService(second, () => new Date(now));
  const day = 86_400_000;
  const attribute = (attributeId, value, operator = 'eq') => ({ attributeId, operator, value, unit: null });

  async function owner(client) {
    const user = await client.user.create({ data: { email: randomUUID() + '@example.invalid', role: Role.Client } });
    ownerIds.push(user.id);
    const chat = await client.chat.create({ data: { userId: user.id } });
    return { chatId: chat.id, userId: user.id };
  }

  async function admit(client, identity) {
    return client.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "Chat" WHERE id = $1 FOR UPDATE', identity.chatId);
      const chat = await tx.chat.update({
        where: { id: identity.chatId },
        data: { consultationInputSeq: { increment: 1 }, consultationAttemptId: randomUUID() },
      });
      const source = await tx.message.create({ data: { chatId: chat.id, authorId: identity.userId,
        role: 'USER', content: 'synthetic input', consultationInputSeq: chat.consultationInputSeq } });
      await tx.chat.update({ where: { id: chat.id }, data: { consultationSourceMessageId: source.id } });
      return { ...identity, sourceMessageId: source.id, inputSeq: chat.consultationInputSeq,
        attemptId: chat.consultationAttemptId, handoffVersion: chat.handoffVersion };
    });
  }

  async function reply(source) {
    return prisma.message.create({ data: { chatId: source.chatId, role: 'ASSISTANT', content: 'ordinary reply',
      assistantSourceMessageId: source.sourceMessageId, expectsEpisodeProjection: true } });
  }

  const candidate = (source, changes) => ({ sourceMessageId: source.sourceMessageId, changes });
  const syntheticTicketAdapter = (source, ticket) => candidate(source, ticket.interactions.map((step) => ({
    taskKey: String(ticket.accountNo) + '/' + step.reference,
    kind: step.previous ? 'update' : 'start',
    previousSourceMessageId: step.previous,
    criteria: { set: step.fields.map(({ field, entry }) => attribute(field, entry)) },
    outcome: step.outcome,
  })));
  const list = (identity) => service.list(identity.chatId, identity.userId);

  try {
    const account = await owner(prisma);
    const alternate = await owner(second);
    for (const [identity, adapt] of [
      [account, (source, steps) => candidate(source, steps.map((step) => ({
        taskKey: step.reference, kind: step.previous ? 'update' : 'start',
        previousSourceMessageId: step.previous, criteria: { set: step.fields.map(({field, entry}) => attribute(field, entry)) },
        outcome: step.outcome,
      })))],
      [alternate, (source, steps) => syntheticTicketAdapter(source, {accountNo: 407, interactions: steps})],
    ]) {
      const first = await admit(prisma, identity);
      const firstBasis = await service.getBasis(first);
      const firstReply = await reply(first);
      const initial = adapt(first, [
        { reference: 'shoe', fields: [{field:'brand',entry:'Alpha'}] },
        { reference: 'coat', fields: [{field:'color',entry:'green'}] },
      ]);
      const races = await Promise.all([
        service.project(firstBasis, firstReply.id, initial),
        other.project(firstBasis, firstReply.id, initial),
      ]);
      assert.deepEqual(races.sort(), ['APPLIED', 'DUPLICATE']);
      assert.equal((await list(identity)).length, 2);

      const late = await admit(prisma, identity);
      const lateBasis = await service.getBasis(late);
      const lateReply = await reply(late);
      const next = await admit(second, identity);
      const nextBasis = await other.getBasis(next);
      const nextReply = await reply(next);
      const valid = adapt(next, [{ reference: 'shoe', previous: first.sourceMessageId,
        fields: [{field:'brand',entry:'Beta'}], outcome:'FINISHED_UNSPECIFIED' }]);
      assert.equal(await other.project(nextBasis, nextReply.id, valid), 'APPLIED');
      assert.equal(await service.project(lateBasis, lateReply.id, adapt(late, [{
        reference:'shoe', previous:first.sourceMessageId, fields:[{field:'brand',entry:'Late'}],
      }])), 'STALE');
      const episodes = await list(identity);
      assert.equal(episodes.find((item) => item.taskKey.endsWith('shoe')).outcome, 'FINISHED_UNSPECIFIED');
      assert.equal(episodes.find((item) => item.taskKey.endsWith('shoe')).snapshot.constraints[0].value, 'Beta');
      assert.equal(episodes.find((item) => item.taskKey.endsWith('coat')).snapshot.constraints[0].value, 'green');
      console.log('Memory contract: ' + (identity === account ? 'consultation' : 'independent ticket adapter'));
    }
    await assert.rejects(service.list(account.chatId, alternate.userId), { name: 'NotFoundException' });
    const interrupted = await admit(prisma, account);
    const interruptedBasis = await service.getBasis(interrupted);
    const interruptedReply = await reply(interrupted);
    await prisma.chat.update({ where:{id:account.chatId}, data:{handoffVersion:{increment:1}} });
    assert.equal(await service.project(interruptedBasis, interruptedReply.id, candidate(interrupted, [
      {taskKey:'handoff-stale',kind:'start'},
    ])), 'STALE');
    const coat = (await list(account)).find(({taskKey}) => taskKey === 'coat');
    const pending = await admit(prisma, account);
    const pendingBasis = await service.getBasis(pending);
    const pendingReply = await reply(pending);
    await service.remove(account.chatId, account.userId, coat.id);
    assert.equal(await service.project(pendingBasis, pendingReply.id, candidate(pending, [{taskKey:'coat',kind:'start'}])), 'STALE');
    assert.equal(await service.getBasis(pending), null);

    const fail = await admit(prisma, account);
    const failBasis = await service.getBasis(fail);
    const failReply = await reply(fail);
    const failing = new ConsultationMemoryService({
      $transaction: (fn, options) => prisma.$transaction(async (tx) => {
        assert.equal(await fn(tx), 'APPLIED');
        throw new Error('synthetic commit failure');
      }, options),
    }, () => new Date(now));
    await assert.rejects(failing.project(failBasis, failReply.id, candidate(fail, [
      {taskKey:'rollback-A',kind:'start'}, {taskKey:'rollback-B',kind:'start'},
    ])), /synthetic commit failure/);
    assert.equal((await list(account)).some(({taskKey}) => taskKey.startsWith('rollback-')), false);
    assert.equal((await prisma.message.findUnique({where:{id:failReply.id}})).content, 'ordinary reply');
    assert.equal(await prisma.consultationTurnReceipt.count({where:{sourceMessageId:fail.sourceMessageId}}), 0);

    const gatewayOwner = await owner(prisma);
    const emissions = [];
    let settle;
    let publicationOrder;
    const projectionAttempted = new Promise((resolve) => { settle = resolve; });
    const realChat = new ChatService({}, prisma, {});
    const gateway = new ChatGateway(realChat, {
      isThreadActive: () => false,
      run: async (_content, _chatId, context, _emit, sourceMessageId) => {
        context.memoryCapture(candidate({sourceMessageId}, [{taskKey:'gateway-failure',kind:'start'}]));
        return { kind:'answer', answer:{type:'product_agent', message:'ordinary gateway reply', groups:[] } };
      },
    }, {}, {}, {
      enabled: true,
      getBasis: (basis) => service.getBasis(basis),
      async project(basis, assistantMessageId, effect) {
        try {
          publicationOrder = {
            answer: emissions.some(([event, message]) => event === 'chat:new_message' && message.id === assistantMessageId),
            idle: emissions.some(([event, state]) => event === 'chat:assistant_status' && state.status === 'IDLE'),
          };
          await failing.project(basis, assistantMessageId, effect);
        } finally {
          settle();
        }
      },
    });
    gateway.server = { to: () => ({emit: (...args) => emissions.push(args)}) };
    const socket = { data:{user:{id:gatewayOwner.userId,role:'Client'}}, emit:(...args) => emissions.push(args) };
    const messageId = randomUUID();
    const ack = [];
    await gateway.sendMessage(socket, {chatId:gatewayOwner.chatId, content:'synthetic gateway input', clientMessageId:messageId},
      (value) => ack.push(value));
    let timeout;
    try {
      await Promise.race([projectionAttempted, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Post-send projection was not attempted')), 5000);
      })]);
    } finally {
      clearTimeout(timeout);
    }
    await gateway.sendMessage(socket, {chatId:gatewayOwner.chatId, content:'synthetic gateway input', clientMessageId:messageId},
      (value) => ack.push(value));
    assert.deepEqual(publicationOrder, { answer:true, idle:true });
    assert.equal(ack[0].id, ack[1].id);
    assert.equal('clientMessageId' in ack[0], false);
    assert.equal(emissions.some(([event]) => event === 'chat:error'), false);
    assert.equal(await prisma.message.count({where:{chatId:gatewayOwner.chatId}}), 2);
    assert.deepEqual(await list(gatewayOwner), []);
    console.log('ChatGateway: post-send failure preserved reply and duplicate input was deduplicated');

    const correction = (await list(alternate)).find(({taskKey}) => taskKey.endsWith('coat'));
    await service.correct(alternate.chatId, alternate.userId, correction.id, correction.revision, {
      criteria:{set:[attribute('color','blue'),attribute('price',9000,'lte')]},
    });
    await assert.rejects(service.correct(alternate.chatId, alternate.userId, correction.id, correction.revision, {
      criteria:{set:[attribute('color','white')]},
    }), { name:'ConflictException' });
    now = startTime + 14 * day;
    assert.equal((await list(alternate)).find(({id}) => id === correction.id).status, 'PAUSED');
    const expiryRace = await admit(prisma, alternate);
    const expiryBasis = await service.getBasis(expiryRace);
    const expiryReply = await reply(expiryRace);
    now = startTime + 90 * day;
    assert.deepEqual(await list(account), []);
    assert.deepEqual(await list(alternate), []);
    assert.equal(await service.purgeExpired(), 3);
    assert.equal(await service.getBasis(expiryRace), null);
    assert.equal(await service.project(expiryBasis, expiryReply.id, candidate(expiryRace, [
      {taskKey:'expired-replay',kind:'start'},
    ])), 'STALE');
    console.log('Memory PostgreSQL: ordering, dedup, handoff, atomic rollback, correction, erasure and expiry passed');
  } finally {
    await prisma.user.deleteMany({where:{id:{in:ownerIds}}});
    await Promise.all([prisma.$disconnect(),second.$disconnect()]);
  }
});
