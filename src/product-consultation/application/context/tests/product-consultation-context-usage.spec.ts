import { describe, expect, it } from '@jest/globals';

import {
  ConsultationApplicationRecordSchema,
  createConsultationApplicationRecord,
} from '../../runtime/consultation-application-record';

import {
  beginSearchExecution,
  commitSearchExecution,
} from '../../../core/results/consultation-results';

import { createSearchSpec } from '../../../core/search/search-spec';

import { createProductConsultationState } from '../../../core/state/consultation-state';

import { buildProductConsultationContext } from '../product-consultation-context';

function adidasSearch() {
  return createSearchSpec({
    semanticIntent: 'мужские кроссовки Adidas',

    category: 'SHOES',

    constraints: [
      {
        attributeId: 'gender',

        operator: 'eq',

        value: 'MAN',

        unit: null,
      },

      {
        attributeId: 'brand',

        operator: 'eq',

        value: 'Adidas',

        unit: null,
      },
    ],
  });
}

function recordWithTaskMemory() {
  const base = createConsultationApplicationRecord();

  const initialState = createProductConsultationState(adidasSearch());

  const started = beginSearchExecution(
    base.results,

    adidasSearch(),

    () => 'execution-adidas',
  );

  const results = commitSearchExecution(
    started.state,

    started.executionId,

    [
      {
        productId: 'adidas-1',

        title: 'HANDBALL SPEZIAL SHOES',

        price: '12500',

        image: null,
      },

      {
        productId: 'adidas-2',

        title: 'Campus 00s',

        price: '12800',

        image: null,
      },
    ],

    () => 'result-adidas',
  );

  return ConsultationApplicationRecordSchema.parse({
    ...base,

    revision: 7,

    generation: 1,

    state: {
      ...initialState,

      memory: {
        version: 1,

        revision: 2,

        memory: {
          goals: [
            {
              goalId: 'internal-goal-id',

              text: 'для повседневной носки',

              importance: 'high',

              sourceText: 'Хочу для повседневной носки',
            },
          ],

          criteria: [
            {
              criterionId: 'internal-criterion-id',

              attributeId: 'price',

              operator: 'lte',

              value: 15000,

              unit: null,

              required: false,

              importance: 'normal',

              sourceText: 'Желательно до 15 тысяч',
            },
          ],

          feedback: [
            {
              productId: 'adidas-1',

              reaction: 'dislike',

              reason: 'слишком массивный',

              attributeId: null,

              sourceText: 'Первый слишком массивный',
            },
          ],
        },
      },
    },

    results,
  });
}

describe('ProductConsultationContext usage knowledge', () => {
  it('exposes semantic task memory without backend-owned IDs', () => {
    const record = recordWithTaskMemory();

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Что из остальных посоветуешь?',
    });

    expect(built.context.task?.memory.goals).toEqual([
      {
        text: 'для повседневной носки',

        importance: 'high',

        sourceText: 'Хочу для повседневной носки',
      },
    ]);

    expect(built.context.task?.memory.criteria).toEqual([
      {
        attributeId: 'price',

        operator: 'lte',

        value: 15000,

        unit: null,

        importance: 'normal',

        sourceText: 'Желательно до 15 тысяч',
      },
    ]);

    expect(built.context.task?.memory.feedback).toEqual([
      {
        position: 1,

        reaction: 'dislike',

        reason: 'слишком массивный',

        attributeId: null,

        sourceText: 'Первый слишком массивный',
      },
    ]);

    const serialized = JSON.stringify(built.context);

    expect(serialized).not.toContain('internal-goal-id');

    expect(serialized).not.toContain('internal-criterion-id');

    expect(serialized).not.toContain('adidas-1');

    expect(built.context.task?.memory.criteria[0]).not.toHaveProperty(
      'required',
    );
  });

  it('exposes a compact usage scenario index for the active profile', () => {
    const built = buildProductConsultationContext({
      record: recordWithTaskMemory(),

      currentMessage: 'Нужны на каждый день',
    });

    expect(built.context.usage?.profileId).toBe('SHOES');

    expect(
      built.context.usage?.available.map((scenario) => scenario.id),
    ).toEqual(['daily_walking', 'training', 'wet_weather', 'cold_weather']);

    expect(built.context.usage?.selected).toEqual([]);

    /**
     * Compact index не тащит
     * тяжёлую instruction.
     */
    expect(built.context.usage?.available[0]).not.toHaveProperty('instruction');

    expect(built.context.usage?.available[0]).not.toHaveProperty(
      'attributeIds',
    );
  });

  it('loads full knowledge only for server-validated selected scenario IDs', () => {
    const record = recordWithTaskMemory();

    const searchBefore = structuredClone(record.state?.search);

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Мне нужны для долгих прогулок',

      usageScenarioIds: ['daily_walking'],
    });

    expect(built.context.usage?.selected).toHaveLength(1);

    expect(built.context.usage?.selected[0]).toEqual(
      expect.objectContaining({
        id: 'daily_walking',

        attributeIds: ['purpose', 'upperMaterial', 'lining', 'sole'],
      }),
    );

    expect(built.context.usage?.selected[0]?.instruction).toContain(
      'не скрытым hard filter',
    );

    expect(built.context.usage?.selected[0]?.question?.question).toContain(
      'повседневной ходьбы',
    );

    /**
     * Scenario knowledge ничего
     * не мутирует в SearchSpec.
     */
    expect(record.state?.search).toEqual(searchBefore);

    expect(built.context.task?.search).toEqual(searchBefore);
  });

  it('rejects a scenario ID belonging to another category', () => {
    expect(() =>
      buildProductConsultationContext({
        record: recordWithTaskMemory(),

        currentMessage: 'Нужны на свадьбу',

        /**
         * formal_event зарегистрирован
         * для CLOTHES, но не SHOES.
         */
        usageScenarioIds: ['formal_event'],
      }),
    ).toThrow(
      'usage scenario formal_event is not registered for profile SHOES',
    );
  });

  it('rejects duplicate or excessive selected usage scenarios', () => {
    expect(() =>
      buildProductConsultationContext({
        record: recordWithTaskMemory(),

        currentMessage: 'Подбери обувь',

        usageScenarioIds: ['daily_walking', 'daily_walking'],
      }),
    ).toThrow('duplicate usage scenario ID');

    expect(() =>
      buildProductConsultationContext({
        record: recordWithTaskMemory(),

        currentMessage: 'Подбери обувь',

        usageScenarioIds: [
          'daily_walking',

          'training',

          'wet_weather',

          'cold_weather',
        ],
      }),
    ).toThrow('at most 3 usage scenarios may be selected');
  });

  it('does not expose feedback for a product outside the bound snapshot', () => {
    const record = recordWithTaskMemory();

    const historicalFeedbackRecord = ConsultationApplicationRecordSchema.parse({
      ...record,

      state: {
        ...record.state!,

        memory: {
          ...record.state!.memory,

          memory: {
            ...record.state!.memory.memory,

            feedback: [
              {
                productId: 'old-product-from-previous-result',

                reaction: 'dislike',

                reason: 'не понравился',

                attributeId: null,

                sourceText: 'Тот старый вариант мне не понравился',
              },
            ],
          },
        },
      },
    });

    const built = buildProductConsultationContext({
      record: historicalFeedbackRecord,

      currentMessage: 'Что ещё есть?',
    });

    expect(built.context.task?.memory.feedback).toEqual([]);

    expect(JSON.stringify(built.context)).not.toContain(
      'old-product-from-previous-result',
    );
  });
});
