import { describe, expect, it } from '@jest/globals';

import {
  emptyProductContext,
  type ProductContext,
} from '@/src/product-consultation/application/context/product-context.schema';

import { emptyConsultationMemory } from '@/src/product-consultation/core/consultation-core.schema';

import { applyProductPlan } from './product-plan';

function createFilters() {
  return {
    gender: null,
    type: null,
    brand: null,
    category: null,
    subcategory: null,
    color: null,
    size: null,
    minPrice: null,
    maxPrice: null,
  };
}

function createContextWithFiveActiveNeeds(): ProductContext {
  const context = emptyProductContext();

  context.needs = Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;

    return {
      needId: `need-${number}`,
      semanticQuery: `товар ${number}`,
      filters: createFilters(),
      preferences: [],
      shownProducts: [],
      consultation: emptyConsultationMemory(),
    };
  });

  context.consultationSession = {
    sessionId: 'session-1',
    status: 'ACTIVE',
    needIds: ['need-1', 'need-2', 'need-3', 'need-4', 'need-5'],
    startedAt: '2026-09-22T00:00:00.000Z',
    lastActivityAt: '2026-09-22T00:00:00.000Z',
    completedAt: null,
    completionReason: null,
    selectedProductIds: [],
    feedback: null,
  };

  return context;
}

describe('applyProductPlan regression', () => {
  it('does not search unchanged needs echoed by the planner', () => {
    const context = emptyProductContext();

    context.needs = [
      {
        needId: 'nike',
        semanticQuery: 'мужские кроссовки Nike',

        filters: {
          ...createFilters(),
          gender: 'MAN',
          type: 'SHOES',
          brand: 'Nike',
          subcategory: 'Кроссовки',
        },

        preferences: [],
        shownProducts: [],
        consultation: emptyConsultationMemory(),
      },

      {
        needId: 'dresses',
        semanticQuery: 'женские платья',

        filters: {
          ...createFilters(),
          gender: 'WOMAN',
          type: 'CLOTHES',
          subcategory: 'Платья',
        },

        preferences: [],
        shownProducts: [],
        consultation: emptyConsultationMemory(),
      },
    ];

    const result = applyProductPlan(
      context,

      {
        action: 'SEARCH',

        updates: [
          {
            needIndex: 1,
            semanticQuery: 'мужские кроссовки Nike',
            filterPatch: {},
            brandMode: 'keep',
            brandValue: null,
            brandSource: null,
            addPreferences: [],
            removePreferences: [],
          },

          {
            needIndex: 2,
            semanticQuery: 'женские платья',
            filterPatch: {},
            brandMode: 'keep',
            brandValue: null,
            brandSource: null,
            addPreferences: [],
            removePreferences: [],
          },

          {
            needIndex: null,
            semanticQuery: 'мужские кроссовки Adidas',

            filterPatch: {
              gender: 'MAN',
              type: 'SHOES',
              subcategory: 'Кроссовки',
            },

            brandMode: 'candidate',
            brandValue: 'Adidas',
            brandSource: 'Adidas',
            addPreferences: [],
            removePreferences: [],
          },
        ],

        removeNeedIndexes: [],
        reuseNeedIndexes: [],
        referenceSource: 'active',
        positions: [],
        attributeIds: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      },

      'а теперь найди мужские кроссовки Adidas',

      new Map([['adidas', 'Adidas']]),
    );

    expect(result.searchNeedIds).toHaveLength(1);

    const searchedNeed = result.productContext.needs.find(
      (need) => need.needId === result.searchNeedIds[0],
    );

    expect(searchedNeed?.semanticQuery).toBe('мужские кроссовки Adidas');

    expect(result.activeNeedIds).toEqual(result.searchNeedIds);
  });
  it('keeps two searches for two explicit independent product intents', () => {
    const context = emptyProductContext();

    const result = applyProductPlan(
      context,

      {
        action: 'SEARCH',

        updates: [
          {
            needIndex: null,
            semanticQuery: 'мужские кроссовки Adidas',

            filterPatch: {
              gender: 'MAN',
              type: 'SHOES',
              subcategory: 'Кроссовки',
            },

            brandMode: 'candidate',
            brandValue: 'Adidas',
            brandSource: 'Adidas',
            addPreferences: [],
            removePreferences: [],
          },

          {
            needIndex: null,
            semanticQuery: 'женское платье',

            filterPatch: {
              gender: 'WOMAN',
              type: 'CLOTHES',
              subcategory: 'Платья',
            },

            brandMode: 'keep',
            brandValue: null,
            brandSource: null,
            addPreferences: [],
            removePreferences: [],
          },
        ],

        removeNeedIndexes: [],
        reuseNeedIndexes: [],
        referenceSource: 'active',
        positions: [],
        attributeIds: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      },

      'найди мужские кроссовки Adidas и женское платье',

      new Map([['adidas', 'Adidas']]),
    );

    expect(result.searchNeedIds).toHaveLength(2);
    expect(result.activeNeedIds).toHaveLength(2);
  });
  it('replaces a removed need without leaving a stale session needId', () => {
    const context = createContextWithFiveActiveNeeds();

    const previousNeedIds = context.needs.map((need) => need.needId);

    const plan = {
      action: 'SEARCH',

      updates: [
        {
          needIndex: null,
          semanticQuery: 'женские платья',

          filterPatch: {
            gender: 'WOMAN',
            type: 'CLOTHES',
            subcategory: 'Платья',
          },

          brandMode: 'keep',
          brandValue: null,
          brandSource: null,

          addPreferences: [],
          removePreferences: [],
        },
      ],

      removeNeedIndexes: [1],

      reuseNeedIndexes: [],

      referenceSource: 'active',

      positions: [],

      attributeIds: [],

      reaction: null,

      completionReason: null,

      handoffReason: null,

      question: null,

      clarificationNeedIndex: null,

      clarificationFields: [],
    };

    const result = applyProductPlan(context, plan, 'найди женские платья');

    expect(result.productContext.needs).toHaveLength(5);

    const session = result.productContext.consultationSession;

    expect(session).not.toBeNull();

    const sessionNeedIds = session?.needIds ?? [];

    expect(sessionNeedIds).toHaveLength(5);

    expect(sessionNeedIds).not.toContain('need-1');

    expect(sessionNeedIds).toEqual(
      expect.arrayContaining(['need-2', 'need-3', 'need-4', 'need-5']),
    );

    const newNeed = result.productContext.needs.find(
      (need) => !previousNeedIds.includes(need.needId),
    );

    expect(newNeed).toBeDefined();

    expect(newNeed?.semanticQuery).toBe('женские платья');

    expect(sessionNeedIds).toContain(newNeed?.needId);
  });
});
