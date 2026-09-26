import { describe, expect, it } from '@jest/globals';

import { resolve } from 'node:path';

import { ConsultationApplicationRecordSchema } from '../../../application/runtime/consultation-application-record';

import { SearchSpecSchema } from '../../../core/search/search-spec.schema';

import { EvaluationScenarioSchema } from '../../contracts/evaluation-scenario';

import {
  loadCurrentProductConsultationFixture,
  type CurrentProductConsultationFixture,
} from '../../fixtures/current-product-consultation.fixture';

import { recordEvaluationScenario } from '../../run-evaluations';

import { OfflineProductConsultationTarget } from '../offline-product-consultation.target';

const fixturePath = resolve(
  process.cwd(),

  'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
);

const scenario = EvaluationScenarioSchema.parse({
  id: 'OFFLINE-VERTICAL-01',

  title: 'Offline deterministic Product Consultation lifecycle',

  description:
    'SEARCH → REFINE → DETAILS → COMPARE → feedback plus recommendation → new task.',

  target: 'product_consultation',

  fixtureId: 'e01-current-catalog',

  initialState: null,

  turns: [
    {
      id: 'T1',

      kind: 'message',

      message: 'Найди мне мужские кроссовки Nike',

      messageId: 'offline-t1',
    },

    {
      id: 'T2',

      kind: 'message',

      message: 'Хочу зелёные, для повседневной носки',

      messageId: 'offline-t2',
    },

    {
      id: 'T3',

      kind: 'message',

      message: 'Окей, тогда Adidas',

      messageId: 'offline-t3',
    },

    {
      id: 'T4',

      kind: 'message',

      message: 'Ладно, цвет не важен',

      messageId: 'offline-t4',
    },

    {
      id: 'T5',

      kind: 'message',

      message: 'Покажи второй вариант подробнее',

      messageId: 'offline-t5',
    },

    {
      id: 'T6',

      kind: 'message',

      message: 'Сравни первый и второй',

      messageId: 'offline-t6',
    },

    {
      id: 'T7',

      kind: 'message',

      message: 'Первый слишком массивный, что из остальных посоветуешь?',

      messageId: 'offline-t7',
    },

    {
      id: 'T8',

      kind: 'message',

      message: 'А теперь найди женские платья',

      messageId: 'offline-t8',
    },
  ],

  checks: [],

  tags: [
    'offline',

    'vertical',

    'deterministic',

    'search',

    'details',

    'compare',

    'feedback',

    'recommendation',

    'task-reset',

    'availability',
  ],
});

const proposals = {
  T1: {
    action: 'SEARCH',

    taskTransition: 'start_new',

    search: {
      semanticIntent: 'мужские кроссовки Nike',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'MAN',

          unit: null,
        },

        {
          attributeId: 'type',

          operator: 'eq',

          value: 'SHOES',

          unit: null,
        },

        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Nike',

          unit: null,
        },
      ],
    },

    searchPatch: null,

    memoryObservations: [],

    selection: null,

    feedback: null,
  },

  T2: {
    action: 'REFINE',

    taskTransition: 'continue',

    search: null,

    searchPatch: {
      semanticIntent:
        'мужские кроссовки Nike\nПожелания: для повседневной носки',

      set: [
        {
          attributeId: 'color',

          operator: 'eq',

          value: 'зелёный',

          unit: null,
        },
      ],

      clear: [],
    },

    /**
     * Это не search constraint.
     *
     * "Для повседневной носки" —
     * цель текущей покупки.
     */
    memoryObservations: [
      {
        kind: 'goal',

        operation: 'remember',

        text: 'для повседневной носки',

        importance: 'high',

        sourceText: 'Хочу зелёные, для повседневной носки',
      },
    ],

    selection: null,

    feedback: null,
  },

  T3: {
    action: 'REFINE',

    taskTransition: 'continue',

    search: null,

    searchPatch: {
      semanticIntent:
        'мужские кроссовки Adidas\nПожелания: для повседневной носки',

      set: [
        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Adidas',

          unit: null,
        },
      ],

      clear: [],
    },

    memoryObservations: [],

    selection: null,

    feedback: null,
  },

  T4: {
    action: 'REFINE',

    taskTransition: 'continue',

    search: null,

    searchPatch: {
      semanticIntent:
        'мужские кроссовки Adidas\nПожелания: для повседневной носки',

      set: [],

      clear: [
        {
          attributeId: 'color',

          operator: 'eq',
        },
      ],
    },

    memoryObservations: [],

    selection: null,

    feedback: null,
  },

  T5: {
    action: 'DETAILS',

    taskTransition: 'continue',

    search: null,

    searchPatch: null,

    memoryObservations: [],

    selection: {
      kind: 'positions',

      positions: [2],
    },

    feedback: null,
  },

  T6: {
    action: 'COMPARE',

    taskTransition: 'continue',

    search: null,

    searchPatch: null,

    memoryObservations: [],

    selection: {
      kind: 'positions',

      positions: [1, 2],
    },

    feedback: null,
  },

  T7: {
    action: 'RECOMMEND',

    taskTransition: 'continue',

    search: null,

    searchPatch: null,

    memoryObservations: [],

    selection: {
      kind: 'positions',

      positions: [2],
    },

    feedback: {
      selection: {
        kind: 'positions',

        positions: [1],
      },

      reaction: 'dislike',

      reason: 'слишком массивный',

      attributeId: null,

      sourceText: 'Первый слишком массивный, что из остальных посоветуешь?',
    },
  },

  T8: {
    action: 'SEARCH',

    /**
     * Это новая независимая покупка.
     *
     * Старый SHOES task
     * не должен участвовать вообще.
     */
    taskTransition: 'start_new',

    search: {
      semanticIntent: 'женские платья',

      category: 'CLOTHES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'WOMAN',

          unit: null,
        },

        {
          attributeId: 'type',

          operator: 'eq',

          value: 'CLOTHES',

          unit: null,
        },
      ],
    },

    searchPatch: null,

    /**
     * Новая task не наследует
     * goal "для повседневной носки".
     */
    memoryObservations: [],

    selection: null,

    feedback: null,
  },
} as const;

async function loadFixture() {
  return loadCurrentProductConsultationFixture(fixturePath);
}

/**
 * Исходный E01 fixture был снят
 * только для обувного сценария.
 *
 * Для проверки task reset нам нужен
 * один дополнительный deterministic
 * captured search.
 *
 * Товары здесь несущественны:
 * успешные zero results полностью
 * достаточны для проверки reset.
 */
function withWomenClothesSearch(
  fixture: CurrentProductConsultationFixture,
): CurrentProductConsultationFixture {
  if (fixture.searches.some((search) => search.key === 'women-clothes')) {
    return fixture;
  }

  return {
    ...fixture,

    searches: [
      ...fixture.searches,

      {
        key: 'women-clothes',

        request: {
          semanticQuery: 'женские платья',

          filters: {
            gender: 'WOMAN',

            type: 'CLOTHES',

            brand: null,

            category: null,

            subcategory: null,

            color: null,

            size: null,

            minPrice: null,

            maxPrice: null,
          },
        },

        products: [],

        consultationBinding: {
          profileId: 'CLOTHES',

          requirements: [],
        },
      },
    ],
  };
}

async function runVerticalFlow(
  fixtureOverride?: CurrentProductConsultationFixture,
) {
  const fixture = withWomenClothesSearch(
    fixtureOverride ?? (await loadFixture()),
  );

  const target = new OfflineProductConsultationTarget(
    fixture,

    proposals,
  );

  return recordEvaluationScenario({
    scenario,

    target,
  });
}

function recordAfterTurn(
  observation: Awaited<ReturnType<typeof runVerticalFlow>>,

  index: number,
) {
  const state = observation.turns[index]?.stateAfter;

  if (state === null || state === undefined) {
    throw new Error(`Missing state after turn ${index + 1}.`);
  }

  return ConsultationApplicationRecordSchema.parse(state);
}

function constraintValue(
  record: ReturnType<typeof recordAfterTurn>,

  attributeId: string,
) {
  return (
    record.state?.search?.constraints.find(
      (constraint) => constraint.attributeId === attributeId,
    )?.value ?? null
  );
}

describe('OfflineProductConsultationTarget', () => {
  it('runs full deterministic flow and starts a clean independent task', async () => {
    const observation = await runVerticalFlow();

    expect(observation.turns).toHaveLength(8);

    const t1 = recordAfterTurn(
      observation,

      0,
    );

    expect(t1.generation).toBe(1);

    expect(
      constraintValue(
        t1,

        'brand',
      ),
    ).toBe('Nike');

    expect(t1.results.active?.products.map((product) => product.title)).toEqual(
      ['Nike SB Dunk Low Pro', 'Nike Mind 002', 'Kobe Air Force 1 Low'],
    );

    const t2 = recordAfterTurn(
      observation,

      1,
    );

    expect(
      constraintValue(
        t2,

        'brand',
      ),
    ).toBe('Nike');

    expect(
      constraintValue(
        t2,

        'color',
      ),
    ).toBe('зелёный');

    /**
     * Цель реально хранится
     * в task Memory.
     */
    expect(t2.state?.memory.memory.goals).toEqual([
      expect.objectContaining({
        text: 'для повседневной носки',

        importance: 'high',
      }),
    ]);

    expect(t2.results.active?.products).toEqual([]);

    const t3 = recordAfterTurn(
      observation,

      2,
    );

    expect(
      constraintValue(
        t3,

        'brand',
      ),
    ).toBe('Adidas');

    expect(
      constraintValue(
        t3,

        'color',
      ),
    ).toBe('зелёный');

    const t4 = recordAfterTurn(
      observation,

      3,
    );

    expect(
      constraintValue(
        t4,

        'brand',
      ),
    ).toBe('Adidas');

    expect(
      constraintValue(
        t4,

        'color',
      ),
    ).toBeNull();

    expect(t4.results.active?.products.map((product) => product.title)).toEqual(
      ['HANDBALL SPEZIAL SHOES', 'Campus 00s'],
    );

    const firstId = t4.results.active?.products[0]?.productId;

    const secondId = t4.results.active?.products[1]?.productId;

    expect(firstId).toBeDefined();

    expect(secondId).toBeDefined();

    const detailsTurn = observation.turns[4]!;

    expect(detailsTurn.resultMetadata).toEqual(
      expect.objectContaining({
        status: 'details_ready',

        resolvedProductIds: [secondId!],
      }),
    );

    const compareTurn = observation.turns[5]!;

    expect(
      compareTurn.toolCalls.filter((call) => call.name === 'compare_products'),
    ).toHaveLength(1);

    const recommendTurn = observation.turns[6]!;

    expect(recommendTurn.resultMetadata).toEqual(
      expect.objectContaining({
        status: 'recommendation_context_ready',

        resolvedProductIds: [secondId!],

        resolvedFeedbackProductIds: [firstId!],

        recommendationCandidateIds: [secondId!],
      }),
    );

    const t7 = recordAfterTurn(
      observation,

      6,
    );

    expect(t7.state?.memory.memory.goals).toEqual([
      expect.objectContaining({
        text: 'для повседневной носки',
      }),
    ]);

    expect(t7.state?.memory.memory.feedback).toEqual([
      expect.objectContaining({
        productId: firstId!,

        reaction: 'dislike',

        reason: 'слишком массивный',
      }),
    ]);

    /**
     * Теперь начинается
     * полностью новая task.
     */
    const t8 = recordAfterTurn(
      observation,

      7,
    );

    expect(t8.generation).toBe(2);

    expect(t8.state?.search?.category).toBe('CLOTHES');

    expect(t8.state?.search?.semanticIntent).toBe('женские платья');

    expect(
      constraintValue(
        t8,

        'gender',
      ),
    ).toBe('WOMAN');

    expect(
      constraintValue(
        t8,

        'type',
      ),
    ).toBe('CLOTHES');

    /**
     * Старый Adidas не протёк.
     */
    expect(
      constraintValue(
        t8,

        'brand',
      ),
    ).toBeNull();

    /**
     * Старый green тоже
     * не существует.
     */
    expect(
      constraintValue(
        t8,

        'color',
      ),
    ).toBeNull();

    /**
     * Старая task Memory
     * полностью сброшена.
     */
    expect(t8.state?.memory.memory.goals).toEqual([]);

    expect(t8.state?.memory.memory.criteria).toEqual([]);

    expect(t8.state?.memory.memory.feedback).toEqual([]);

    /**
     * Новая successful zero-result
     * выдача принадлежит CLOTHES task.
     *
     * Старый Adidas snapshot
     * больше не является active
     * или lastConfirmed.
     */
    expect(t8.results.active?.resultId).toBe('result-T8');

    expect(t8.results.active?.products).toEqual([]);

    expect(t8.results.active?.search.category).toBe('CLOTHES');

    expect(t8.results.lastConfirmed?.resultId).toBe('result-T8');

    expect(t8.results.lastConfirmed?.products).toEqual([]);

    /**
     * Idempotency history conversation-а
     * при этом не сбрасывается.
     *
     * Это не task Memory.
     */
    expect(t8.processedRequestIds).toEqual([
      'offline-t1',

      'offline-t2',

      'offline-t3',

      'offline-t4',

      'offline-t5',

      'offline-t6',

      'offline-t7',

      'offline-t8',
    ]);
  });

  it('uses search only when the current turn actually requires retrieval', async () => {
    const observation = await runVerticalFlow();

    /**
     * T1-T4 делают search.
     */
    for (let index = 0; index < 4; index += 1) {
      const turn = observation.turns[index]!;

      expect(
        turn.toolCalls.filter((call) => call.name === 'search_products'),
      ).toHaveLength(1);
    }

    /**
     * DETAILS / COMPARE /
     * RECOMMEND не делают search.
     */
    for (const index of [4, 5, 6]) {
      expect(
        observation.turns[index]!.toolCalls.filter(
          (call) => call.name === 'search_products',
        ),
      ).toHaveLength(0);
    }

    /**
     * T8 — новая задача,
     * поэтому ровно один новый search.
     */
    const newTaskTurn = observation.turns[7]!;

    const newTaskSearchCalls = newTaskTurn.toolCalls.filter(
      (call) => call.name === 'search_products',
    );

    expect(newTaskSearchCalls).toHaveLength(1);

    const newTaskSearch = SearchSpecSchema.parse(newTaskSearchCalls[0]?.args);

    expect(newTaskSearch.category).toBe('CLOTHES');

    expect(newTaskSearch.semanticIntent).toBe('женские платья');

    expect(newTaskSearch.constraints).toEqual([
      {
        attributeId: 'gender',

        operator: 'eq',

        value: 'WOMAN',

        unit: null,
      },

      {
        attributeId: 'type',

        operator: 'eq',

        value: 'CLOTHES',

        unit: null,
      },
    ]);

    /**
     * Полностью offline:
     * модель ни разу не вызывается.
     */
    expect(observation.turns.flatMap((turn) => turn.llmCalls)).toEqual([]);

    expect(observation.turns.flatMap((turn) => turn.errors)).toEqual([]);
  });

  it('does not use a no-longer-eligible product for details, compare or recommendation context', async () => {
    const fixture = await loadFixture();

    const adidasSearch = fixture.searches.find(
      (search) => search.key === 'adidas-daily',
    );

    if (!adidasSearch || adidasSearch.products.length < 2) {
      throw new Error('Fixture must contain two Adidas daily products.');
    }

    const unavailableProductId = adidasSearch.products[1]!.id;

    const fixtureAfterAvailabilityChange: CurrentProductConsultationFixture = {
      ...fixture,

      productDetails: fixture.productDetails.filter(
        (product) => product.id !== unavailableProductId,
      ),
    };

    const observation = await runVerticalFlow(fixtureAfterAvailabilityChange);

    const beforeDetails = recordAfterTurn(
      observation,

      3,
    );

    expect(beforeDetails.results.active?.products[1]?.productId).toBe(
      unavailableProductId,
    );

    const detailsTurn = observation.turns[4]!;

    expect(detailsTurn.resultMetadata).toEqual(
      expect.objectContaining({
        status: 'product_unavailable',
      }),
    );

    expect(
      detailsTurn.artifacts.filter(
        (artifact) => artifact.kind === 'product_details',
      ),
    ).toHaveLength(0);

    const compareTurn = observation.turns[5]!;

    expect(
      compareTurn.toolCalls.filter((call) => call.name === 'compare_products'),
    ).toHaveLength(0);

    expect(compareTurn.resultMetadata).toEqual(
      expect.objectContaining({
        status: 'product_unavailable',
      }),
    );

    const recommendTurn = observation.turns[6]!;

    expect(
      recommendTurn.toolCalls.filter((call) => call.name === 'search_products'),
    ).toHaveLength(0);

    expect(recommendTurn.resultMetadata).toEqual(
      expect.objectContaining({
        status: 'product_unavailable',

        recommendationCandidateIds: [],
      }),
    );

    /**
     * Даже после неудачного
     * recommendation context
     * новая task всё равно
     * должна стартовать чисто.
     */
    const newTask = recordAfterTurn(
      observation,

      7,
    );

    expect(newTask.generation).toBe(2);

    expect(newTask.state?.search?.category).toBe('CLOTHES');

    expect(newTask.state?.memory.memory.feedback).toEqual([]);

    expect(
      constraintValue(
        newTask,

        'brand',
      ),
    ).toBeNull();
  });
});
