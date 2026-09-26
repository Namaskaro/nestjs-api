import { describe, expect, it } from '@jest/globals';

import type { AgentComparisonView } from '../../../core/consultation-core.schema';

import {
  beginSearchExecution,
  commitSearchExecution,
} from '../../../core/results/consultation-results';

import { createSearchSpec } from '../../../core/search/search-spec';

import { createProductConsultationState } from '../../../core/state/consultation-state';

import {
  ConsultationApplicationRecordSchema,
  createConsultationApplicationRecord,
} from '../../runtime/consultation-application-record';

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

function activeRecord() {
  const base = createConsultationApplicationRecord();

  const state = createProductConsultationState(adidasSearch());

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

    revision: 5,

    generation: 1,

    state,

    results,
  });
}

function comparison(): AgentComparisonView {
  return {
    comparisonId: 'internal-comparison-id',

    needId: 'internal-need-id',

    profileId: 'SHOES',

    memoryRevision: 42,

    productIds: ['adidas-1', 'adidas-2'],

    rows: [
      {
        attributeId: 'price',

        criterionIds: ['internal-criterion-id'],

        state: 'numeric_difference',

        range: {
          min: 12500,

          max: 12800,

          spread: 300,

          unit: null,
        },

        cells: [
          {
            productId: 'adidas-1',

            status: 'known',

            value: 12500,

            unit: null,

            displayValue: '12 500 ₽',
          },

          {
            productId: 'adidas-2',

            status: 'known',

            value: 12800,

            unit: null,

            displayValue: '12 800 ₽',
          },
        ],
      },

      {
        attributeId: 'weight',

        criterionIds: [],

        state: 'unknown',

        range: null,

        cells: [
          {
            productId: 'adidas-1',

            status: 'unknown',

            value: null,

            unit: 'kg',

            displayValue: null,
          },

          {
            productId: 'adidas-2',

            status: 'unknown',

            value: null,

            unit: 'kg',

            displayValue: null,
          },
        ],
      },
    ],

    requirementChecks: [
      {
        requirementId: 'internal-requirement-id',

        productId: 'adidas-1',

        outcome: 'pass',
      },
    ],

    limitations: ['Вес обоих товаров неизвестен.'],
  };
}

describe('ProductConsultationContext comparison observation', () => {
  it('projects deterministic comparison to ordinal positions without backend-owned IDs', () => {
    const built = buildProductConsultationContext({
      record: activeRecord(),

      currentMessage: 'Сравни первый и второй',

      comparison: comparison(),
    });

    expect(built.context.comparison).toEqual({
      rows: [
        {
          attributeId: 'price',

          state: 'numeric_difference',

          range: {
            min: 12500,

            max: 12800,

            spread: 300,

            unit: null,
          },

          cells: [
            {
              position: 1,

              status: 'known',

              value: 12500,

              unit: null,

              displayValue: '12 500 ₽',
            },

            {
              position: 2,

              status: 'known',

              value: 12800,

              unit: null,

              displayValue: '12 800 ₽',
            },
          ],
        },

        {
          attributeId: 'weight',

          state: 'unknown',

          range: null,

          cells: [
            {
              position: 1,

              status: 'unknown',

              value: null,

              unit: 'kg',

              displayValue: null,
            },

            {
              position: 2,

              status: 'unknown',

              value: null,

              unit: 'kg',

              displayValue: null,
            },
          ],
        },
      ],

      limitations: ['Вес обоих товаров неизвестен.'],
    });

    /**
     * Ни один internal identifier
     * из deterministic Core
     * в LLM context не протёк.
     */
    const serialized = JSON.stringify(built.context.comparison);

    expect(serialized).not.toContain('adidas-1');

    expect(serialized).not.toContain('adidas-2');

    expect(serialized).not.toContain('internal-comparison-id');

    expect(serialized).not.toContain('internal-need-id');

    expect(serialized).not.toContain('internal-criterion-id');

    expect(serialized).not.toContain('internal-requirement-id');
  });

  it('preserves unknown comparison state instead of ranking it', () => {
    const built = buildProductConsultationContext({
      record: activeRecord(),

      currentMessage: 'Какой легче?',

      comparison: comparison(),
    });

    const weight = built.context.comparison?.rows.find(
      (row) => row.attributeId === 'weight',
    );

    expect(weight).toEqual({
      attributeId: 'weight',

      state: 'unknown',

      range: null,

      cells: [
        {
          position: 1,

          status: 'unknown',

          value: null,

          unit: 'kg',

          displayValue: null,
        },

        {
          position: 2,

          status: 'unknown',

          value: null,

          unit: 'kg',

          displayValue: null,
        },
      ],
    });
  });

  it('rejects comparison referencing a product outside the bound snapshot', () => {
    const invalid = comparison();

    invalid.productIds = ['adidas-1', 'foreign-product'];

    invalid.rows[0]!.cells[1] = {
      ...invalid.rows[0]!.cells[1]!,

      productId: 'foreign-product',
    };

    expect(() =>
      buildProductConsultationContext({
        record: activeRecord(),

        currentMessage: 'Сравни варианты',

        comparison: invalid,
      }),
    ).toThrow(
      'comparison product foreign-product does not belong to the bound result snapshot',
    );
  });
});
