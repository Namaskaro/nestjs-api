const assert = require('node:assert/strict');
const { hash } = require('argon2');
const { spec, vector } = require('./ai.cjs');

const id = (n) => `76100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const login = {
  buyer: 'buyer@review-live.invalid',
  manager: 'manager@review-live.invalid',
  password: 'ReviewLive26!',
};
const products = [
  { id: id(1), title: 'Кроссовки Альфа', price: '4900', color: '#39685c' },
  { id: id(2), title: 'Кроссовки Бета', price: '5700', color: '#815941' },
  { id: id(3), title: 'Кроссовки Гамма', price: '6400', color: '#465c88' },
];
const description =
  'Городские кроссовки для прогулок. Тестовый товар магазина Review Intelligence.';

function image(product) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#f0ede4"/>
  <ellipse cx="320" cy="330" rx="220" ry="20" fill="#d4d2ca"/>
  <path d="M108 291 L154 224 Q185 208 212 229 L262 266 L345 255 L410 195
    Q438 171 465 219 L491 270 Q548 282 548 314 L103 314 Z" fill="${product.color}"/>
  <path d="M98 308 Q322 320 548 307 L542 333 L110 333 Z" fill="#fff"/>
  <path d="M303 263 l38 9 m-19 -23 l38 9 m-18 -24 l38 9" stroke="#eee" stroke-width="7"/>
  <text x="320" y="405" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#252525">${product.title}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function seed({ db, reviews, index, summary, qdrant }) {
  const [identity] =
    await db.$queryRaw`SELECT current_database() AS db, current_user AS role`;
  assert.deepEqual(identity, {
    db: 'support_engine_it',
    role: 'support_engine_it',
  });
  const users = [
    {
      id: id(101),
      name: 'Тестовый покупатель',
      email: login.buyer,
      role: 'Client',
    },
    {
      id: id(102),
      name: 'Тестовый менеджер',
      email: login.manager,
      role: 'Manager',
    },
    ...Array.from({ length: 24 }, (_, i) => ({
      id: id(103 + i),
      name: `Покупатель ${i + 1}`,
      email: `reader${i + 1}@review-live.invalid`,
      role: 'Client',
    })),
  ];
  const password = await hash(login.password);
  const categoryId = id(20),
    subcategoryId = id(21),
    brandId = id(22);
  await db.$transaction(
    async (tx) => {
      for (const user of users) {
        const current = await tx.user.findUnique({ where: { id: user.id } });
        if (current)
          assert.equal(
            current.email,
            user.email,
            'Unexpected user at fixture id',
          );
        else
          await tx.user.create({
            data: {
              ...user,
              password,
              emailVerified: true,
              bio: { reviewLive: true },
            },
          });
      }
      await tx.category.upsert({
        where: { id: categoryId },
        update: {},
        create: {
          id: categoryId,
          name: 'Тестовая обувь',
          slug: 'review-live-shoes',
        },
      });
      await tx.subcategory.upsert({
        where: { id: subcategoryId },
        update: {},
        create: {
          id: subcategoryId,
          name: 'Кроссовки для прогулок',
          slug: 'review-live-sneakers',
          categoryId,
          gender: 'UNISEX',
          imageUrl: image(products[0]),
        },
      });
      await tx.brand.upsert({
        where: { id: brandId },
        update: {},
        create: {
          id: brandId,
          name: 'Review Live',
          coverImg: image(products[0]),
        },
      });
      for (const product of products) {
        const picture = image(product);
        await tx.product.upsert({
          where: { id: product.id },
          update: {},
          create: {
            id: product.id,
            title: product.title,
            price: product.price,
            description,
            images: [picture],
            blurURL: [picture],
            sizes: ['40', '41', '42'],
            gender: 'UNISEX',
            type: 'SHOES',
            stock: 12,
            inStock: true,
            brandId,
            subcategoryId,
            details: ['Мягкая подошва', 'Для городских прогулок'],
          },
        });
      }
      for (const [i, user] of users
        .filter(({ role }) => role === 'Client')
        .entries()) {
        await tx.order.upsert({
          where: { id: id(300 + i) },
          update: {},
          create: {
            id: id(300 + i),
            cartId: id(400 + i),
            userId: user.id,
            status: 'DELIVERED',
            totalAmount: 17000,
            finalAmount: 17000,
            comment: 'review-live-fixture',
            items: products.map((p) => ({
              productId: p.id,
              title: p.title,
              image: null,
              quantity: 1,
              size: '41',
              price: p.price,
            })),
          },
        });
      }
    },
    { timeout: 15000 },
  );
  const snippets = [
    'Мягкая подошва, удобно гулять по городу.',
    'Ходил около часа. Стопа не устала.',
    'Комфортные на прогулке, посадка немного плотная.',
    'Удобно ходить по асфальту. Размер подошёл.',
    'Понравилась лёгкость. В первое время пришлось разносить.',
  ];
  const putReview = async (userId, productId, rating, text, decision) => {
    if (
      await db.review.findUnique({
        where: { userId_productId: { userId, productId } },
      })
    )
      return;
    const row = await reviews.createReview(userId, { productId, rating, text });
    if (decision)
      await reviews.moderateReview(id(102), row.id, {
        publicationId: row.publicationId,
        decision,
        ...(decision === 'REJECTED' ? { reason: 'Тестовое отклонение' } : {}),
      });
  };
  for (let i = 0; i < 24; i++) {
    await putReview(
      id(103 + i),
      products[0].id,
      i % 4 ? 5 : 4,
      snippets[i % snippets.length],
      i < 22 ? 'PUBLISHED' : i === 23 ? 'REJECTED' : null,
    );
  }
  for (let i = 0; i < 3; i++)
    await putReview(
      id(103 + i),
      products[1].id,
      3 + (i % 2),
      snippets[i],
      'PUBLISHED',
    );
  await qdrant.createEmbeddingCollection('products', spec.dimensions);
  for (const product of products) {
    await qdrant.savePoint('products', {
      id: product.id,
      vector: {
        dense: vector,
        bm25: { model: 'qdrant/bm25', text: description },
      },
      payload: {
        productId: product.id,
        title: product.title,
        description,
        brandId,
        brand: 'Review Live',
        categoryId,
        category: 'Тестовая обувь',
        subcategoryId,
        subcategory: 'Кроссовки для прогулок',
        color: null,
        price: Number(product.price),
        gender: 'UNISEX',
        type: 'SHOES',
        sizes: ['40', '41', '42'],
        stock: 12,
        image: image(product),
        inStock: true,
        searchText: description,
        semanticRepresentation: {
          summary: 'Кроссовки для прогулок',
          targetAudience: [],
          styleAssociations: [],
          useCases: ['Городские прогулки'],
          pricePositioning: 'Тестовый каталог',
          searchTags: [],
        },
      },
    });
  }
  for (
    let i = 0;
    i < 10 && (await db.review.count({ where: { indexPending: true } }));
    i++
  )
    await index.runPending();
  await db.reviewSummary.updateMany({
    where: {
      productId: products[0].id,
      summary: null,
      nextAttemptAt: { not: null },
    },
    data: { nextAttemptAt: new Date(0) },
  });
  await summary.runPending();
  const result = await reviews.getReviewExperience(
    products.map(({ id }) => id),
  );
  return {
    products: products.map(({ id, title }) => ({
      id,
      title,
      ratingCount: result.get(id)?.ratingCount,
    })),
    summary: !!result.get(products[0].id)?.summary,
  };
}

module.exports = { seed, login, products };
