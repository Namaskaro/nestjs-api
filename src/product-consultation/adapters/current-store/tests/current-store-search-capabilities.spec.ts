import { describe, expect, it } from '@jest/globals';

import {
  compileCurrentStoreSearchSpec,
  CURRENT_STORE_SEARCH_CAPABILITIES,
} from '../current-store-search-spec';

describe('CurrentStore search capabilities', () => {
  it('publishes supported consultation profiles', () => {
    expect(CURRENT_STORE_SEARCH_CAPABILITIES.profileIds).toEqual([
      'SHOES',

      'CLOTHES',

      'ACCESSORIES',
    ]);
  });

  it('uses the same executable capability vocabulary as SearchSpec compiler', () => {
    expect(CURRENT_STORE_SEARCH_CAPABILITIES.constraints).toEqual([
      {
        attributeId: 'brand',

        operators: ['eq'],

        modelVisible: true,
      },

      {
        attributeId: 'category',

        operators: ['eq'],

        modelVisible: true,
      },

      {
        attributeId: 'subcategory',

        operators: ['eq'],

        modelVisible: true,
      },

      {
        attributeId: 'type',

        operators: ['eq'],

        modelVisible: false,
      },

      {
        attributeId: 'gender',

        operators: ['eq'],

        modelVisible: true,
      },

      {
        attributeId: 'color',

        operators: ['eq'],

        modelVisible: true,
      },

      {
        attributeId: 'sizes',

        operators: ['contains'],

        modelVisible: true,
      },

      {
        attributeId: 'price',

        operators: ['eq', 'gte', 'lte'],

        modelVisible: true,
      },
    ]);
  });

  it('keeps legacy type execution available but hides it from model capability suggestions', () => {
    const typeCapability = CURRENT_STORE_SEARCH_CAPABILITIES.constraints.find(
      (capability) => capability.attributeId === 'type',
    );

    expect(typeCapability).toEqual({
      attributeId: 'type',

      operators: ['eq'],

      modelVisible: false,
    });

    expect(
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'мужские кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'type',

            operator: 'eq',

            value: 'SHOES',

            unit: null,
          },
        ],
      }).filters.type,
    ).toBe('SHOES');
  });

  it('rejects a hard attribute absent from the published store capabilities', () => {
    expect(
      CURRENT_STORE_SEARCH_CAPABILITIES.constraints.some(
        (capability) => capability.attributeId === 'waterProtection',
      ),
    ).toBe(false);

    expect(() =>
      compileCurrentStoreSearchSpec({
        version: 1,

        semanticIntent: 'кроссовки с водозащитой',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'waterProtection',

            operator: 'eq',

            value: true,

            unit: null,
          },
        ],
      }),
    ).toThrow(
      'unsupported hard constraint waterProtection:eq for current store search',
    );
  });
});
