import { describe, expect, it } from '@jest/globals';

import {
  SearchConstraintSchema,
  SearchSpecPatchSchema,
} from './search-spec.schema';

import {
  assertSearchSpecMatchesCategoryProfile,
  assertSearchSpecPatchMatchesCategoryProfile,
} from './search-spec-profile';

function shoesProfile() {
  return {
    id: 'SHOES',

    version: 1,

    attributes: [
      {
        id: 'brand',

        label: 'Бренд',

        kind: 'text' as const,

        unit: null,

        allowedOperators: ['eq' as const],

        comparison: 'exact' as const,
      },

      {
        id: 'price',

        label: 'Цена',

        kind: 'number' as const,

        unit: 'RUB',

        allowedOperators: ['eq' as const, 'lte' as const, 'gte' as const],

        comparison: 'numeric' as const,
      },

      {
        id: 'weight',

        label: 'Вес',

        kind: 'number' as const,

        unit: 'g',

        allowedOperators: ['eq' as const, 'lte' as const, 'gte' as const],

        comparison: 'numeric' as const,
      },

      {
        id: 'waterproof',

        label: 'Водостойкость',

        kind: 'boolean' as const,

        unit: null,

        allowedOperators: ['eq' as const],

        comparison: 'exact' as const,
      },

      {
        id: 'materials',

        label: 'Материалы',

        kind: 'set' as const,

        unit: null,

        allowedOperators: ['contains' as const],

        comparison: 'set' as const,
      },
    ],

    defaultCriteria: [],

    criticalAttributes: [],

    guidance: [],

    questions: [],

    knowledgeRefs: [],
  };
}

describe('SearchSpec CategoryProfile validation', () => {
  it('accepts valid SearchSpec for category profile', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'мужские кроссовки для повседневной носки',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'brand',

              operator: 'eq',

              value: 'Nike',

              unit: null,
            },

            {
              attributeId: 'price',

              operator: 'lte',

              value: 20000,

              unit: 'RUB',
            },

            {
              attributeId: 'materials',

              operator: 'contains',

              value: 'leather',

              unit: null,
            },
          ],
        },

        shoesProfile(),
      ),
    ).not.toThrow();
  });

  it('rejects unknown attribute', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'мужские кроссовки',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'enginePower',

              operator: 'gte',

              value: 500,

              unit: 'hp',
            },
          ],
        },

        shoesProfile(),
      ),
    ).toThrow('unknown attribute enginePower');
  });

  it('rejects boolean value for numeric attribute', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'лёгкие кроссовки',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'weight',

              operator: 'lte',

              value: true,

              unit: 'g',
            },
          ],
        },

        shoesProfile(),
      ),
    ).toThrow('attribute weight requires number value');
  });

  it('rejects operator unsupported by attribute', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'кроссовки Nike',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'brand',

              operator: 'lte',

              value: 'Nike',

              unit: null,
            },
          ],
        },

        shoesProfile(),
      ),
    ).toThrow('operator lte is not allowed for attribute brand');
  });

  it('rejects wrong unit', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'лёгкие кроссовки',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'weight',

              operator: 'lte',

              value: 1,

              unit: 'kg',
            },
          ],
        },

        shoesProfile(),
      ),
    ).toThrow('attribute weight requires unit g, received kg');
  });

  it('rejects SearchSpec for another category profile', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'женские платья',

          category: 'DRESS',

          constraints: [],
        },

        shoesProfile(),
      ),
    ).toThrow('category DRESS does not match profile SHOES');
  });

  it('accepts valid SearchSpec patch', () => {
    expect(() =>
      assertSearchSpecPatchMatchesCategoryProfile(
        {
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

        shoesProfile(),
      ),
    ).not.toThrow();
  });

  it('rejects invalid value inside SearchSpec patch', () => {
    expect(() =>
      assertSearchSpecPatchMatchesCategoryProfile(
        {
          set: [
            {
              attributeId: 'weight',

              operator: 'lte',

              value: false,

              unit: 'g',
            },
          ],

          clear: [],
        },

        shoesProfile(),
      ),
    ).toThrow('attribute weight requires number value');
  });

  it('rejects changing main category through patch', () => {
    expect(() =>
      assertSearchSpecPatchMatchesCategoryProfile(
        {
          category: 'DRESS',

          set: [],

          clear: [],
        },

        shoesProfile(),
      ),
    ).toThrow('use a new SEARCH');
  });

  it('rejects unknown fields in SearchSpec patch instead of silently stripping them', () => {
    const parsed = SearchSpecPatchSchema.safeParse({
      constraints: [],

      set: [],

      clear: [],
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects unknown fields inside constraint', () => {
    const parsed = SearchConstraintSchema.safeParse({
      attributeId: 'brand',

      operator: 'eq',

      value: 'Nike',

      unit: null,

      mystery: 'should-not-be-here',
    });

    expect(parsed.success).toBe(false);
  });
});
