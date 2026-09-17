import {
  CATEGORY_PROFILES,
  CLOTHES_PROFILE,
} from '../agents/product-agent/category-profiles';
import {
  ConsultationCore,
  type ConsultationNeedSnapshot,
} from '../agents/product-agent/consultation-core/consultation-core';
import {
  ProductDetailsSchema,
  ProductFactSchema,
  emptyConsultationMemory,
  type ProductDetails,
  type ProductFact,
} from '../agents/product-agent/consultation-core/consultation-core.schema';

const OBSERVED_AT = '2026-09-14T00:00:00.000Z';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected=${JSON.stringify(
        expected,
      )}, actual=${JSON.stringify(actual)}`,
    );
  }
}

function assertThrows(action: () => unknown, expectedMessage: string): void {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes(expectedMessage)) {
      throw new Error(
        `Ожидалась ошибка "${expectedMessage}", получено "${message}"`,
      );
    }

    return;
  }

  throw new Error(
    `Ожидалась ошибка "${expectedMessage}", но операция завершилась успешно`,
  );
}

function productFact(
  productId: string,
  attributeId: string,
  value: ProductFact['value'],
  displayValue: string | null,
): ProductFact {
  const definition = CLOTHES_PROFILE.attributes.find(
    (attribute) => attribute.id === attributeId,
  );

  if (!definition) {
    throw new Error(
      `Test fixture: неизвестный clothes attribute ${attributeId}`,
    );
  }

  if (value === null) {
    return ProductFactSchema.parse({
      attributeId,
      kind: definition.kind,
      unit: definition.unit,
      status: 'unknown',
      value: null,
      displayValue: null,
      provenance: [],
    });
  }

  return ProductFactSchema.parse({
    attributeId,
    kind: definition.kind,
    unit: definition.unit,
    status: 'known',
    value,
    displayValue,
    provenance: [
      {
        sourceId: 'debug:catalog',
        recordId: productId,
        observedAt: OBSERVED_AT,
        updatedAt: OBSERVED_AT,
        paths: [`Product.${attributeId}`],
        transformation: null,
      },
    ],
  });
}

function createProduct(input: {
  id: string;
  title: string;
  price: number;
  color: string;
  sizes: string[];
  material: string | null;
  inStock: boolean;
  stock: number;
}): ProductDetails {
  return ProductDetailsSchema.parse({
    id: input.id,
    title: input.title,
    description: `${input.title} debug product`,
    productType: 'CLOTHES',
    profileId: 'CLOTHES',
    price: String(input.price),
    currency: 'RUB',
    discount: '0',
    images: [],
    availability: {
      inStock: input.inStock,
      stock: input.stock,
    },
    brand: {
      id: 'brand-tom-ford',
      name: 'Tom Ford',
    },
    category: {
      id: 'category-clothes',
      name: 'Одежда',
    },
    subcategory: {
      id: 'subcategory-suits',
      name: 'Костюмы',
    },
    attributes: [
      productFact(input.id, 'price', input.price, `${input.price} ₽`),
      productFact(input.id, 'type', 'CLOTHES', 'Одежда'),
      productFact(
        input.id,
        'inStock',
        input.inStock,
        input.inStock ? 'В наличии' : 'Нет в наличии',
      ),
      productFact(input.id, 'stock', input.stock, String(input.stock)),
      productFact(input.id, 'color', input.color, input.color),
      productFact(input.id, 'sizes', input.sizes, input.sizes.join(', ')),
      productFact(input.id, 'material', input.material, input.material),
    ],
    source: {
      sourceId: 'debug:catalog',
      recordId: input.id,
      observedAt: OBSERVED_AT,
      updatedAt: OBSERVED_AT,
    },
  });
}

function createCore() {
  const productA = createProduct({
    id: 'product-a',
    title: 'Black Wool Suit',
    price: 18000,
    color: 'Черный',
    sizes: ['48', '50'],
    material: 'Шерсть',
    inStock: true,
    stock: 2,
  });

  const productB = createProduct({
    id: 'product-b',
    title: 'Navy Suit',
    price: 19000,
    color: 'Темно-синий',
    sizes: ['48'],
    material: null,
    inStock: false,
    stock: 0,
  });

  const need: ConsultationNeedSnapshot = {
    needId: 'need-suit',
    query: 'костюм на свадьбу',
    preferences: ['желательно тёмный'],
    profileId: 'CLOTHES',
    memory: emptyConsultationMemory(),
    requirements: [
      {
        requirementId: 'filter:type',
        attributeId: 'type',
        operator: 'eq',
        value: 'CLOTHES',
        unit: null,
        resolution: 'resolved',
        label: 'Тип: одежда',
      },
      {
        requirementId: 'filter:maxPrice',
        attributeId: 'price',
        operator: 'lte',
        value: 20000,
        unit: null,
        resolution: 'resolved',
        label: 'Цена до 20 000 ₽',
      },
      {
        requirementId: 'filter:inStock',
        attributeId: 'inStock',
        operator: 'eq',
        value: true,
        unit: null,
        resolution: 'resolved',
        label: 'Товар в наличии',
      },
    ],
    allowedProductIds: ['product-a', 'product-b'],
    displayedProductIds: ['product-a', 'product-b'],
    comparisonProductIds: ['product-a', 'product-b'],
  };

  const core = new ConsultationCore({
    needs: [need],
    products: [productA, productB],
    profiles: CATEGORY_PROFILES,
    budget: {
      toolCallsPerTurn: 16,
      comparisonsPerTurn: 4,
    },
  });

  return {
    core,
  };
}

function run(): void {
  console.log('CONSULTATION CORE DETERMINISTIC DEBUG');
  console.log('Paid LLM calls: 0');
  console.log('');

  const { core } = createCore();

  const initial = core.initialView('need-suit');

  assertEqual(initial.needId, 'need-suit', 'initial.needId');

  assertEqual(initial.memoryRevision, 0, 'initial.memoryRevision');

  assertEqual(initial.profile.id, 'CLOTHES', 'initial.profile.id');

  assertEqual(initial.preferences.length, 1, 'initial.preferences.length');

  assertEqual(
    initial.preferences[0]?.text,
    'желательно тёмный',
    'initial preference',
  );

  assertEqual(initial.products.length, 2, 'initial.products.length');

  console.log(
    '✅ Initial view содержит правильный need, profile, preferences и товары',
  );

  const memoryUpdate = core.updateMemory({
    needId: 'need-suit',
    expectedRevision: 0,
    patch: {
      goals: {
        add: [
          {
            text: 'Подобрать костюм на свадьбу',
            importance: 'high',
            sourceText: 'костюм на свадьбу',
          },
        ],
        update: [],
        remove: [],
      },
      criteria: {
        add: [
          {
            attributeId: 'material',
            operator: 'observe',
            value: null,
            unit: null,
            required: false,
            importance: 'high',
            sourceText: 'материал важен',
          },
        ],
        update: [],
        remove: [],
      },
      feedback: {
        upsert: [],
        remove: [],
      },
    },
  });

  assertEqual(memoryUpdate.memoryRevision, 1, 'memory revision after update');

  assertEqual(memoryUpdate.memory.goals.length, 1, 'goals after update');

  assertEqual(memoryUpdate.memory.criteria.length, 1, 'criteria after update');

  const goalId = memoryUpdate.memory.goals[0]?.goalId;

  const criterionId = memoryUpdate.memory.criteria[0]?.criterionId;

  assert(goalId, 'Сервер не создал goalId');

  assert(criterionId, 'Сервер не создал criterionId');

  console.log(
    '✅ Core создаёт server-owned goalId/criterionId и повышает revision',
  );

  assertThrows(
    () =>
      core.updateMemory({
        needId: 'need-suit',
        expectedRevision: 0,
        patch: {
          goals: {
            add: [],
            update: [],
            remove: [],
          },
          criteria: {
            add: [],
            update: [],
            remove: [],
          },
          feedback: {
            upsert: [],
            remove: [],
          },
        },
      }),
    'stale memory revision',
  );

  console.log('✅ Stale memoryRevision отклоняется');

  assertThrows(
    () =>
      core.updateMemory({
        needId: 'need-suit',
        expectedRevision: 1,
        patch: {
          goals: {
            add: [],
            update: [],
            remove: [],
          },
          criteria: {
            add: [
              {
                attributeId: 'upperMaterial',
                operator: 'observe',
                value: null,
                unit: null,
                required: false,
                importance: 'normal',
                sourceText: 'материал верха',
              },
            ],
            update: [],
            remove: [],
          },
          feedback: {
            upsert: [],
            remove: [],
          },
        },
      }),
    'is not part of profile CLOTHES',
  );

  console.log('✅ CLOTHES не принимает shoe-only attribute upperMaterial');

  const comparison = core.compareProducts({
    needId: 'need-suit',
    expectedRevision: 1,
    productIds: ['product-a', 'product-b'],
    attributeIds: ['price', 'color', 'material', 'inStock'],
  });

  const priceRow = comparison.rows.find((row) => row.attributeId === 'price');

  const colorRow = comparison.rows.find((row) => row.attributeId === 'color');

  const materialRow = comparison.rows.find(
    (row) => row.attributeId === 'material',
  );

  assert(priceRow, 'Нет price row');

  assert(colorRow, 'Нет color row');

  assert(materialRow, 'Нет material row');

  assertEqual(priceRow.state, 'numeric_difference', 'price comparison');

  assertEqual(colorRow.state, 'different', 'color comparison');

  assertEqual(materialRow.state, 'unknown', 'material comparison');

  const productAStockCheck = comparison.requirementChecks.find(
    (check) =>
      check.productId === 'product-a' &&
      check.requirementId === 'filter:inStock',
  );

  const productBStockCheck = comparison.requirementChecks.find(
    (check) =>
      check.productId === 'product-b' &&
      check.requirementId === 'filter:inStock',
  );

  assertEqual(
    productAStockCheck?.outcome,
    'pass',
    'product A stock requirement',
  );

  assertEqual(
    productBStockCheck?.outcome,
    'fail',
    'product B stock requirement',
  );

  console.log(
    '✅ Deterministic comparison различает numeric/different/unknown',
  );

  console.log('✅ Hard requirements проверяются отдельно для каждого товара');

  const firstArtifacts = core.artifacts([comparison.comparisonId]);

  assertEqual(
    firstArtifacts.comparisons.length,
    1,
    'comparison artifacts before memory change',
  );

  assertEqual(
    firstArtifacts.comparisons[0]?.comparisonId,
    comparison.comparisonId,
    'comparison artifact id',
  );

  console.log('✅ Актуальное сравнение доступно как server-side artifact');

  const verifiedRecommendation = core.verifyRecommendation('need-suit', {
    productId: 'product-a',
    role: 'primary',
    reasons: [
      {
        attributeId: 'price',
        reference: {
          kind: 'requirement',
          id: 'filter:maxPrice',
        },
        text: 'Укладывается в заданный бюджет.',
      },
    ],
    tradeoffs: [],
    unknowns: [],
  });

  assertEqual(
    verifiedRecommendation.productId,
    'product-a',
    'verified recommendation product',
  );

  assertEqual(
    verifiedRecommendation.reasons[0]?.fact.value,
    18000,
    'verified recommendation fact',
  );

  console.log(
    '✅ Recommendation проходит только через реальный exposed known fact',
  );

  assertThrows(
    () =>
      core.verifyRecommendation('need-suit', {
        productId: 'product-b',
        role: 'primary',
        reasons: [
          {
            attributeId: 'price',
            reference: {
              kind: 'requirement',
              id: 'filter:maxPrice',
            },
            text: 'Укладывается в бюджет.',
          },
        ],
        tradeoffs: [],
        unknowns: [],
      }),
    'does not prove requirement',
  );

  console.log('✅ Товар с failed hard requirement нельзя рекомендовать');

  const feedbackUpdate = core.updateMemory({
    needId: 'need-suit',
    expectedRevision: 1,
    patch: {
      goals: {
        add: [],
        update: [],
        remove: [],
      },
      criteria: {
        add: [],
        update: [],
        remove: [],
      },
      feedback: {
        upsert: [
          {
            productId: 'product-a',
            reaction: 'dislike',
            reason: 'Не нравится этот вариант',
            attributeId: null,
            sourceText: 'первый не нравится',
          },
        ],
        remove: [],
      },
    },
  });

  assertEqual(feedbackUpdate.memoryRevision, 2, 'revision after feedback');

  assertEqual(feedbackUpdate.memory.feedback.length, 1, 'feedback count');

  console.log('✅ Feedback сохраняется адресно на конкретный productId');

  assertThrows(
    () => core.artifacts([comparison.comparisonId]),
    'stale comparison',
  );

  console.log('✅ Изменение memory инвалидирует старое сравнение');

  assertThrows(
    () =>
      core.verifyRecommendation('need-suit', {
        productId: 'product-a',
        role: 'primary',
        reasons: [
          {
            attributeId: 'price',
            reference: {
              kind: 'requirement',
              id: 'filter:maxPrice',
            },
            text: 'Укладывается в бюджет.',
          },
        ],
        tradeoffs: [],
        unknowns: [],
      }),
    'disliked product',
  );

  console.log('✅ Dislike блокирует повторную рекомендацию товара');

  assertThrows(
    () =>
      core.getProductDetails({
        needId: 'need-suit',
        productIds: ['product-not-allowed'],
        attributeIds: ['price'],
        presentation: 'facts',
      }),
    'unauthorized product',
  );

  console.log('✅ Product outside allow-list недоступен через tools');

  const freshComparison = core.compareProducts({
    needId: 'need-suit',
    expectedRevision: 2,
    productIds: ['product-a', 'product-b'],
    attributeIds: ['price', 'color', 'material', 'inStock'],
  });

  assert(
    freshComparison.comparisonId !== comparison.comparisonId,
    'Новое сравнение должно получить новый comparisonId',
  );

  assertEqual(freshComparison.memoryRevision, 2, 'fresh comparison revision');

  const freshArtifacts = core.artifacts([freshComparison.comparisonId]);

  assertEqual(
    freshArtifacts.comparisons.length,
    1,
    'fresh comparison artifacts',
  );

  assertEqual(
    freshArtifacts.comparisons[0]?.memoryRevision,
    2,
    'fresh artifact memory revision',
  );

  console.log(
    '✅ После изменения memory новое сравнение строится на актуальном revision',
  );

  core.seal();

  const committed = core.committedMemories();

  assertEqual(committed.length, 1, 'committed memory count');

  assertEqual(committed[0]?.memory.goals.length, 1, 'committed goals');

  assertEqual(committed[0]?.memory.criteria.length, 1, 'committed criteria');

  assertEqual(committed[0]?.memory.feedback.length, 1, 'committed feedback');

  console.log(
    '✅ После seal Core отдаёт готовую persistent consultation memory',
  );

  console.log('');

  console.log('✅ CONSULTATION CORE DETERMINISTIC DEBUG PASSED');
}

try {
  run();
} catch (error) {
  console.error('');

  console.error('❌ CONSULTATION CORE DETERMINISTIC DEBUG FAILED');

  console.error(error instanceof Error ? error.message : error);

  process.exitCode = 1;
}
