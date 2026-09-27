import { describe, expect, it } from '@jest/globals';

import { compileCurrentStoreSearchSpec } from '../current-store-search-spec';

describe('CurrentStore SearchSpec compiler', () => {
  it('compiles supported SearchSpec constraints into existing ProductNeed hard filters', () => {
    const result = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'лаконичные городские кроссовки',

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

        {
          attributeId: 'color',

          operator: 'eq',

          value: 'зелёный',

          unit: null,
        },

        {
          attributeId: 'sizes',

          operator: 'contains',

          value: '43',

          unit: null,
        },

        {
          attributeId: 'price',

          operator: 'gte',

          value: 10000,

          unit: null,
        },

        {
          attributeId: 'price',

          operator: 'lte',

          value: 20000,

          unit: null,
        },
      ],
    });

    expect(result).toEqual({
      semanticQuery: 'лаконичные городские кроссовки',

      filters: {
        gender: 'MAN',

        type: 'SHOES',

        brand: 'Nike',

        category: null,

        subcategory: null,

        color: 'зелёный',

        size: '43',

        minPrice: 10000,

        maxPrice: 20000,
      },
    });
  });

  it('normalizes semantic English male value into current-store MAN', () => {
    const result = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'мужские кроссовки Nike',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'male',

          unit: null,
        },
      ],
    });

    expect(result.filters.gender).toBe('MAN');
  });

  it('normalizes semantic Russian male value into current-store MAN', () => {
    const result = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'мужские кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'мужской',

          unit: null,
        },
      ],
    });

    expect(result.filters.gender).toBe('MAN');
  });

  it('normalizes semantic female values into current-store WOMAN', () => {
    expect(
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'женское платье',

        category: 'CLOTHES',

        constraints: [
          {
            attributeId: 'gender',

            operator: 'eq',

            value: 'female',

            unit: null,
          },
        ],
      }).filters.gender,
    ).toBe('WOMAN');

    expect(
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'женские кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'gender',

            operator: 'eq',

            value: 'женские',

            unit: null,
          },
        ],
      }).filters.gender,
    ).toBe('WOMAN');
  });

  it('normalizes unisex semantic value into current-store UNISEX', () => {
    const result = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'унисекс кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'унисекс',

          unit: null,
        },
      ],
    });

    expect(result.filters.gender).toBe('UNISEX');
  });

  it('rejects unknown semantic gender instead of guessing', () => {
    expect(() =>
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'gender',

            operator: 'eq',

            value: 'something-unknown',

            unit: null,
          },
        ],
      }),
    ).toThrow('unsupported current-store gender something-unknown');
  });

  it('compiles price:eq into exact legacy price range', () => {
    const result = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'городские кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'price',

          operator: 'eq',

          value: 15000,

          unit: null,
        },
      ],
    });

    expect(result.filters.minPrice).toBe(15000);

    expect(result.filters.maxPrice).toBe(15000);
  });

  it('rejects valid consultation attribute that current search cannot execute as hard filter', () => {
    expect(() =>
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'лёгкие кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'weight',

            operator: 'lte',

            value: 0.5,

            unit: 'kg',
          },
        ],
      }),
    ).toThrow(
      'unsupported hard constraint weight:lte for current store search',
    );
  });

  it('rejects operator that current-store filter cannot execute for attribute', () => {
    expect(() =>
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'sizes',

            operator: 'eq',

            value: '43',

            unit: null,
          },
        ],
      }),
    ).toThrow(
      'constraint sizes:eq is not executable by current store search; expected operator contains',
    );
  });

  it('rejects unsupported current-store type domain value', () => {
    expect(() =>
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'товар',

        category: 'GENERIC',

        constraints: [
          {
            attributeId: 'type',

            operator: 'eq',

            value: 'CAR',

            unit: null,
          },
        ],
      }),
    ).toThrow('unsupported current-store product type CAR');
  });

  it('rejects simultaneous category and subcategory until current-store search can execute both', () => {
    expect(() =>
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'category',

            operator: 'eq',

            value: 'Обувь',

            unit: null,
          },

          {
            attributeId: 'subcategory',

            operator: 'eq',

            value: 'Кроссовки',

            unit: null,
          },
        ],
      }),
    ).toThrow(
      'simultaneous category:eq and subcategory:eq are not executable by current store search',
    );
  });
});
