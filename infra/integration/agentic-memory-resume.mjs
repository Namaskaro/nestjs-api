import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { withServices } from './environment.mjs';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { PrismaClient, Role } = require('../../prisma/generated');
const { WsException } = require('@nestjs/websockets');
const { ChatService } = require('../../src/modules/chat/chat.service');
const { ChatGateway } = require('../../src/modules/chat/chat.gateway');
const { ChatHandoffService } = require('../../src/modules/chat/chat-handoff.service');
const { ConsultationMemoryService } = require('../../src/consultation-memory/consultation-memory.service');
const { openMemoryWorkspace, filterMemoryContext } = require('../../src/support-agent/graph/nodes/memory-workspace');
const { applySearchSpecPatch } = require('../../src/product-consultation/core/search/search-spec');
const { CurrentStoreSearchSpecAdapter } = require('../../src/product-consultation/adapters/current-store/current-store-search-spec.adapter');
const { CurrentStoreProductSearchService } = require('../../src/product-consultation/adapters/current-store/current-store-product-search.service');
const { CurrentStoreCatalogService } = require('../../src/product-consultation/adapters/current-store/current-store-catalog.service');
const { QdrantService } = require('../../src/core/qdrant/qdrant.service');
const { normalizeSearchFilterValue } = require('../../src/shared/utils/normalize-search-filter-value');

const runId = randomUUID();
process.env.CONSULTATION_MEMORY_ENABLED = '1';
process.env.CONSULTATION_MEMORY_STORE_KEY = 'resume-it-' + runId;

const day = 86_400_000;
const startTime = Date.now() - 14 * day;
const constraint = (attributeId, value, operator = 'eq') => ({ attributeId, value, operator, unit: null });
const notFound = { name: 'NotFoundException' };
const conflict = { name: 'ConflictException' };

await withServices(async ({ databaseUrl, qdrant }) => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const second = new PrismaClient({ datasourceUrl: databaseUrl });
  const ownerIds = [];
  let now = startTime;
  const memory = new ConsultationMemoryService(prisma, () => new Date(now));
  const otherMemory = new ConsultationMemoryService(second, () => new Date(now));
  const chat = new ChatService({}, prisma, {}, memory);
  const otherChat = new ChatService({}, second, {}, otherMemory);
  let hasPendingInterrupt = false;
  let assistantRuns = 0;
  const gateway = new ChatGateway(chat, {
    isThreadActive: () => false,
    hasPendingInterrupt: async () => hasPendingInterrupt,
    run: async () => { assistantRuns += 1; },
  }, new ChatHandoffService(prisma), {}, memory);

  const collection = 'resume-catalog-' + runId;
  const collectionPath = '/collections/' + collection;
  let collectionCreated = false;
  let catalogFixture;
  let queries = 0;
  let lastRetrieved = [];
  const qdrantService = new QdrantService({
    async query(name, body) {
      assert.equal(name, 'products');
      queries += 1;
      const { result } = await qdrant('POST', collectionPath + '/points/query', body);
      lastRetrieved = result.points.map(({ id }) => id);
      return result;
    },
  });
  const productSearch = new CurrentStoreSearchSpecAdapter(new CurrentStoreProductSearchService(
    { embeddingFailover: false, createQueryEmbedding: async () => [1, 0, 0] },
    qdrantService,
    { rerank: async () => assert.fail('Fixture should have only one eligible catalog result') },
    prisma,
    new CurrentStoreCatalogService(prisma, qdrantService),
  ));

  async function owner() {
    const user = await prisma.user.create({
      data: { email: randomUUID() + '@example.invalid', role: Role.Client },
    });
    ownerIds.push(user.id);
    const conversation = await prisma.chat.create({ data: { userId: user.id } });
    return { chatId: conversation.id, userId: user.id };
  }

  async function seedEpisode(identity, taskKey, constraints) {
    const input = await chat.createParticipantMessage({
      ...identity, content: 'Синтетический запрос', trackConsultation: true,
    });
    const { admission } = input;
    assert.ok(admission);
    const basis = await memory.getBasis(admission);
    assert.ok(basis);
    const reply = await chat.createAssistantMessageIfCurrent({
      ...identity, expectedHandoffVersion: admission.handoffVersion, content: 'Синтетический ответ',
      sourceMessageId: admission.sourceMessageId, expectsEpisodeProjection: true,
    });
    assert.equal(await memory.project(basis, reply.id, {
      sourceMessageId: admission.sourceMessageId,
      changes: [{ taskKey, kind: 'start', criteria: { profileId: 'SHOES', set: constraints } }],
    }), 'APPLIED');
    const episodes = await memory.list(identity.chatId, identity.userId);
    const episode = episodes.find((value) => value.taskKey === taskKey);
    assert.ok(episode);
    return episode;
  }

  async function seedCatalog(userId) {
    const fixture = await prisma.$transaction(async (tx) => {
      const previousBrand = await tx.brand.create({ data: { name: 'Past-' + runId, coverImg: '' } });
      const currentBrand = await tx.brand.create({ data: { name: 'Current-' + runId, coverImg: '' } });
      const category = await tx.category.create({ data: { name: 'Shoes-' + runId } });
      const subcategory = await tx.subcategory.create({
        data: { name: 'Trainers-' + runId, categoryId: category.id, gender: 'UNISEX', imageUrl: '' },
      });
      const product = (title, brandId, color, price) => tx.product.create({
        data: {
          title, brandId, color, price, userId, subcategoryId: subcategory.id,
          description: 'Synthetic catalog', type: 'SHOES', gender: 'UNISEX',
          inStock: true, stock: 3, images: [], sizes: ['42'],
        },
      });
      const prior = await product('Prior pair', previousBrand.id, 'синий', '5000');
      const stale = await product('Index price became stale', currentBrand.id, 'зелёный', '7200');
      const current = await product('Current pair', currentBrand.id, 'зелёный', '7500');
      return { previousBrand, currentBrand, category, subcategory, prior, stale, current };
    });
    catalogFixture = fixture;

    await qdrant('PUT', collectionPath, {
      vectors: { dense: { size: 3, distance: 'Cosine' } },
      sparse_vectors: { bm25: { modifier: 'idf' } },
    });
    collectionCreated = true;
    const point = (product, brand, vector) => ({
      id: product.id,
      vector: { dense: vector, bm25: { indices: [1], values: [1] } },
      payload: {
        productId: product.id, title: product.title, description: product.description,
        brandId: brand.id, brand: brand.name, categoryId: fixture.category.id, category: fixture.category.name,
        subcategoryId: fixture.subcategory.id, subcategory: fixture.subcategory.name,
        color: product.color, colorKey: normalizeSearchFilterValue(product.color), price: Number(product.price),
        gender: product.gender, type: product.type, sizes: product.sizes, stock: product.stock,
        inStock: true, image: '', searchText: 'synthetic shoes',
        semanticRepresentation: {
          summary: 'Synthetic trainers', targetAudience: [], styleAssociations: [], useCases: [],
          pricePositioning: 'synthetic', searchTags: [],
        },
      },
    });
    await qdrant('PUT', collectionPath + '/points?wait=true', { points: [
      point(fixture.prior, fixture.previousBrand, [1, 0, 0]),
      point(fixture.stale, fixture.currentBrand, [1, 0, 0]),
      point(fixture.current, fixture.currentBrand, [0.8, 0.6, 0]),
    ] });
    return fixture;
  }

  try {
    const main = await owner();
    const stranger = await owner();
    const declined = await owner();
    const expiring = await owner();
    const catalog = await seedCatalog(main.userId);
    const oldConstraints = [
      constraint('brand', catalog.previousBrand.name), constraint('color', 'синий'), constraint('price', 6000, 'lte'),
    ];
    const priorEpisode = await seedEpisode(main, 'trainers', oldConstraints);
    await seedEpisode(declined, 'decline-target', oldConstraints);
    await seedEpisode(expiring, 'expiry-target', oldConstraints);
    const oldSearch = { version: 1, semanticIntent: 'synthetic shoes', category: 'SHOES', constraints: oldConstraints };
    const ids = (result) => result.map(({ productId }) => productId);
    assert.deepEqual(ids(await productSearch.search(oldSearch)), [catalog.prior.id]);

    now = startTime + 7 * day - 1;
    assert.equal(await memory.getResumeOffer(main.chatId, main.userId), null);
    now += 1;
    const socket = { data: { user: { id: main.userId, role: Role.Client } }, join: async () => {} };
    const ordinaryJoin = await gateway.joinChat(socket, { chatId: main.chatId });
    assert.equal(Object.hasOwn(ordinaryJoin, 'consultationOffer'), false);
    const [opened, reconnect] = await Promise.all([
      gateway.joinChat(socket, { chatId: main.chatId, requestConsultationOffer: true }),
      otherMemory.getResumeOffer(main.chatId, main.userId),
    ]);
    const offer = opened.consultationOffer;
    assert.ok(offer);
    assert.equal(offer.state, 'pending');
    assert.deepEqual(reconnect, offer);
    assert.equal(await memory.getResumeOffer(main.chatId, stranger.userId), null);
    await assert.rejects(memory.decideResumeOffer(main.chatId, stranger.userId, offer.offerId, 'continue'), notFound);

    const originalStoreKey = process.env.CONSULTATION_MEMORY_STORE_KEY;
    try {
      process.env.CONSULTATION_MEMORY_STORE_KEY = 'another-store-' + runId;
      assert.equal(await memory.getResumeOffer(main.chatId, main.userId), null);
      assert.deepEqual(await memory.list(main.chatId, main.userId), []);
    } finally {
      process.env.CONSULTATION_MEMORY_STORE_KEY = originalStoreKey;
    }
    await prisma.user.update({ where: { id: main.userId }, data: { role: Role.Guest } });
    try {
      assert.equal(await memory.getResumeOffer(main.chatId, main.userId), null);
      await assert.rejects(memory.list(main.chatId, main.userId), notFound);
    } finally {
      await prisma.user.update({ where: { id: main.userId }, data: { role: Role.Client } });
    }
    console.log('A2: store and guest scopes cannot read an existing customer episode');

    const countBeforeDecision = queries;
    const decision = { chatId: main.chatId, offerId: offer.offerId, decision: 'continue' };
    hasPendingInterrupt = true;
    await assert.rejects(gateway.decideConsultationResume(socket, decision),
      (error) => error instanceof WsException && error.getError().status === 'conflict');
    hasPendingInterrupt = false;
    const [continued, sameDecision] = await Promise.all([
      gateway.decideConsultationResume(socket, decision),
      otherMemory.decideResumeOffer(main.chatId, main.userId, offer.offerId, 'continue'),
    ]);
    assert.equal(continued.decision, 'continue');
    assert.deepEqual(sameDecision, continued);
    assert.equal(continued.continuationOfferId, offer.offerId);
    assert.equal((await memory.getResumeOffer(main.chatId, main.userId)).state, 'continued');
    assert.equal(assistantRuns, 0, 'Continue must not invoke the support graph');
    assert.equal(queries, countBeforeDecision, 'Continue must not query the catalog');
    const unchanged = (await memory.list(main.chatId, main.userId))[0];
    assert.equal(unchanged.lastMeaningfulAt.getTime(), priorEpisode.lastMeaningfulAt.getTime());
    assert.equal(unchanged.expiresAt.getTime(), priorEpisode.expiresAt.getTime());

    const nextInput = {
      ...main, content: 'Нужен другой бренд, зелёный цвет и бюджет до 8000',
      trackConsultation: true, continuationOfferId: continued.continuationOfferId,
      clientMessageId: randomUUID(),
    };
    const competingInput = { ...nextInput, clientMessageId: randomUUID() };
    const admissions = await Promise.allSettled([
      chat.createParticipantMessage(nextInput),
      otherChat.createParticipantMessage(competingInput),
    ]);
    assert.deepEqual(admissions.map(({ status }) => status).sort(), ['fulfilled', 'rejected']);
    const winner = admissions.findIndex(({ status }) => status === 'fulfilled');
    assert.equal(admissions[1 - winner].reason.name, conflict.name);
    const admitted = admissions[winner].value;
    const basis = await memory.getBasis(admitted.admission);
    assert.ok(basis?.continuation);
    assert.equal(basis.continuation.episodeId, priorEpisode.id);
    assert.equal(basis.continuation.taskKey, priorEpisode.taskKey);
    const duplicate = await otherChat.createParticipantMessage([nextInput, competingInput][winner]);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.message.id, admitted.message.id);
    assert.equal(await prisma.message.count({ where: { chatId: main.chatId, role: 'USER' } }), 2);
    assert.equal(queries, countBeforeDecision, 'Binding the input must not query the catalog');

    const query = 'synthetic current green shoes';
    const restored = openMemoryWorkspace(null, query, {
      memoryContinuation: basis.continuation, memoryWitnesses: basis.witnesses,
    });
    assert.equal(openMemoryWorkspace(null, query), null, 'Independent searches must not receive saved criteria');
    const restoredSearch = restored.tasks[0].record.state.search;
    assert.deepEqual(restoredSearch.constraints, basis.continuation.snapshot.constraints);
    const currentConstraints = [
      constraint('brand', catalog.currentBrand.name), constraint('color', 'зелёный'), constraint('price', 8000, 'lte'),
    ];
    const revised = applySearchSpecPatch(restoredSearch, { set: currentConstraints, clear: [] });
    assert.deepEqual(new Map(revised.constraints.map((value) => [value.attributeId, value])),
      new Map(currentConstraints.map((value) => [value.attributeId, value])));
    await prisma.product.update({ where: { id: catalog.prior.id }, data: { inStock: false, stock: 0 } });
    await prisma.product.update({ where: { id: catalog.stale.id }, data: { price: '16000' } });
    assert.deepEqual(ids(await productSearch.search(oldSearch)), [], 'Current stock overrides the historical index');
    assert.deepEqual(ids(await productSearch.search(revised)), [catalog.current.id]);
    assert.ok(lastRetrieved.includes(catalog.stale.id), 'The old indexed price must reach the SQL eligibility check');
    await memory.verifyReplyCurrent(basis);
    await memory.remove(main.chatId, main.userId, priorEpisode.id);
    assert.equal(await memory.getBasis(admitted.admission), null);
    await assert.rejects(chat.createAssistantMessageIfCurrent({
      ...main, expectedHandoffVersion: admitted.admission.handoffVersion,
      content: 'Синтетический устаревший ответ',
      sourceMessageId: admitted.admission.sourceMessageId, replyBasis: basis,
    }), conflict);
    assert.equal(await prisma.message.count({ where: {
      chatId: main.chatId, assistantSourceMessageId: admitted.admission.sourceMessageId,
    } }), 0);
    assert.deepEqual(filterMemoryContext(restored, [], { memoryWitnesses: {} }).workspace.tasks, []);
    console.log('A2: one-use admission, owner checks, reconnect and fresh Qdrant/PostgreSQL catalog passed');

    const laterOffer = await memory.getResumeOffer(declined.chatId, declined.userId);
    assert.equal((await memory.decideResumeOffer(declined.chatId, declined.userId, laterOffer.offerId, 'later')).decision, 'later');
    assert.equal(await memory.getResumeOffer(declined.chatId, declined.userId), null);
    now = startTime + 14 * day - 1;
    assert.equal((await memory.list(declined.chatId, declined.userId))[0].status, 'OPEN');
    assert.equal(await memory.getResumeOffer(declined.chatId, declined.userId), null);
    now += 1;
    assert.equal((await memory.list(declined.chatId, declined.userId))[0].status, 'PAUSED');
    assert.equal(await memory.getResumeOffer(declined.chatId, declined.userId), null, 'The same revision must not return after cooldown');

    now = startTime + 90 * day - 1;
    assert.equal((await memory.list(expiring.chatId, expiring.userId))[0].status, 'PAUSED');
    const expiringOffer = await memory.getResumeOffer(expiring.chatId, expiring.userId);
    assert.equal(expiringOffer.expiresAt.getTime(), startTime + 90 * day);
    now += 1;
    assert.deepEqual(await memory.list(expiring.chatId, expiring.userId), []);
    assert.equal(await memory.getResumeOffer(expiring.chatId, expiring.userId), null);
    await assert.rejects(memory.decideResumeOffer(expiring.chatId, expiring.userId, expiringOffer.offerId, 'continue'), conflict);
    console.log('A2: exact 7/14/90-day boundaries, decline cooldown and offer expiry passed');
  } finally {
    try {
      if (collectionCreated) await qdrant('DELETE', collectionPath);
    } finally {
      try {
        await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
        if (catalogFixture) {
          const { previousBrand, currentBrand, subcategory, category } = catalogFixture;
          await prisma.$transaction([
            prisma.subcategory.delete({ where: { id: subcategory.id } }),
            prisma.category.delete({ where: { id: category.id } }),
            prisma.brand.deleteMany({ where: { id: { in: [previousBrand.id, currentBrand.id] } } }),
          ]);
        }
      } finally {
        await Promise.all([prisma.$disconnect(), second.$disconnect()]);
      }
    }
  }
});
