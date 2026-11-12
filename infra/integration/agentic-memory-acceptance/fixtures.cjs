const assert = require('node:assert/strict');
const accounts = ['new', 'continue', 'decline', 'paused', 'expire', 'other', 'reconnect', 'verify', 'verify-new', 'verify-decline', 'fresh', 'context', 'context-alt', 'context-expiry'];
const password = 'Memory-V1-Local-482!';
const address = name => name + '@memory-v1.example.test';
const id = number => 'e4229ad0-0000-4000-8000-' + String(number).padStart(12, '0');
const withEpisodes = new Set(['continue', 'decline', 'paused', 'expire', 'reconnect', 'verify', 'verify-decline', 'fresh']);
const catalog = [
  ['Aurora Blue 5000', 'Aurora', 'синий', 5000],
  ['Nord Green 7500', 'Nord', 'зелёный', 7500],
  ['Nord Green 9200', 'Nord', 'зелёный', 9200],
  ['Atlas Red 6800', 'Atlas', 'красный', 6800],
];

async function provision({ prisma, chat, memory, qdrant, requireApp, vector, original }) {
  const passwordHash = await requireApp('argon2').hash(password);
  const identities = {};
  const initialEpisodes = [];
  for (const [index, name] of accounts.entries()) {
    const userId = id(index + 1);
    const email = address(name);
    const collision = await prisma.user.findUnique({ where: { email } });
    assert.ok(!collision || collision.id === userId, 'Fixture account collision');
    const owner = await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, email, name: 'Приёмка · ' + name, password: passwordHash, emailVerified: true },
      update: {},
    });
    assert.equal(owner.email, email, 'Fixture identity mismatch');
    assert.equal(owner.role, 'Client', 'Fixture is not a test customer');
    const existingChat = await prisma.chat.findUnique({ where: { userId } });
    const conversation = existingChat ?? await prisma.chat.create({ data: { userId } });
    identities[name] = { userId, chatId: conversation.id };
    if (!existingChat && withEpisodes.has(name)) initialEpisodes.push(name);
  }
  const category = await prisma.category.upsert({ where: { name: 'Обувь' }, create: { name: 'Обувь', slug: 'acceptance-shoes' }, update: {} });
  const subcategory = await prisma.subcategory.upsert({
    where: { name: 'Кроссовки' },
    create: { name: 'Кроссовки', categoryId: category.id, gender: 'UNISEX', imageUrl: '/uploads/acceptance-shoe.svg', slug: 'acceptance-trainers' },
    update: {},
  });
  const points = [];
  for (const [index, [title, brandName, color, price]] of catalog.entries()) {
    const brand = await prisma.brand.upsert({ where: { name: brandName }, create: { name: brandName, coverImg: '/uploads/acceptance-shoe.svg' }, update: {} });
    const productId = id(100 + index);
    const image = '/uploads/acceptance-shoe.svg';
    const description = 'Синтетические кроссовки для локальной приёмки.';
    const product = await prisma.product.upsert({
      where: { id: productId },
      create: { id: productId, title, brandId: brand.id, color, price: String(price), userId: identities.new.userId,
        subcategoryId: subcategory.id, description, type: 'SHOES', gender: 'UNISEX',
        inStock: true, stock: 3, images: [image], sizes: ['42'] },
      update: {},
    });
    points.push({
      id: productId, vector: { dense: vector, bm25: { indices: [1], values: [1] } },
      payload: { productId, title, description, brandId: brand.id, brand: brandName, categoryId: category.id, category: category.name,
        subcategoryId: subcategory.id, subcategory: subcategory.name, color, colorKey: color.replace('ё', 'е'), price,
        gender: product.gender, type: product.type, sizes: product.sizes, stock: product.stock,
        inStock: true, image, searchText: 'кроссовки ' + title, semanticRepresentation: {
          summary: description, targetAudience: [], styleAssociations: [], useCases: [], pricePositioning: 'средний', searchTags: [],
        } },
    });
  }
  await qdrant('PUT', '/collections/products/points?wait=true', { points });
  for (const name of initialEpisodes) await seedEpisode(chat, memory, identities[name], name, original);
  return identities;
}

async function seedEpisode(chat, memory, identity, name, original) {
    const input = await chat.createParticipantMessage({
      ...identity, content: 'Подбери синие кроссовки Aurora до 6000 рублей.', trackConsultation: true,
    });
    assert.ok(input.admission);
    const basis = await memory.getBasis(input.admission);
    assert.ok(basis);
    const reply = await chat.createAssistantMessageIfCurrent({
      ...identity, expectedHandoffVersion: input.admission.handoffVersion,
      content: 'Подбор открыт. Нашёл синие Aurora Blue 5000 за 5 000 ₽.',
      sourceMessageId: input.admission.sourceMessageId, expectsEpisodeProjection: true,
    });
    assert.equal(await memory.project(basis, reply.id, {
      sourceMessageId: input.admission.sourceMessageId,
      changes: [{ taskKey: 'browser-acceptance-' + name, kind: 'start', criteria: { profileId: 'SHOES', set: original } }],
    }), 'APPLIED');
}

async function reset({ prisma, chat, memory, identities, name, original, clearProfile = true, reseed = true }) {
  const identity = identities[name];
  assert.ok(identity && accounts.includes(name), 'Unknown fixture');
  const next = await prisma.$transaction(async tx => {
    const owner = await tx.user.findUnique({ where: { id: identity.userId } });
    assert.ok(owner?.email === address(name) && owner.role === 'Client', 'Fixture owner mismatch');
    if (clearProfile) await tx.userContextScope.deleteMany({
      where: { storeKey: process.env.CONSULTATION_MEMORY_STORE_KEY, subjectKey: identity.userId },
    });
    await tx.chat.delete({ where: { id: identity.chatId, userId: identity.userId } });
    return tx.chat.create({ data: { userId: identity.userId } });
  });
  identities[name] = { userId: identity.userId, chatId: next.id };
  if (reseed && withEpisodes.has(name)) await seedEpisode(chat, memory, identities[name], name, original);
}
module.exports = { accounts, address, password, provision, reset, seedEpisode };
