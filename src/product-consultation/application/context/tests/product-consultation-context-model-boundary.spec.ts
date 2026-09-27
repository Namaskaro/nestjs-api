import { describe, expect, it } from '@jest/globals';

import type {
  AgentComparisonView,
  ProductDetails,
} from '../../../core/consultation-core.schema';

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

const PRODUCT_ONE_ID = '27807943-51e2-49fd-a0eb-4f3cd6568177';

const PRODUCT_TWO_ID = 'c32a02c1-3315-477b-8509-c3c461aa27ce';

const NIKE_ID = '09ce3fcd-7160-45b3-8e1e-6914c91c6df7';

const ADIDAS_ID = 'e6ccf0cb-06f1-4762-8420-6d70e6412e3a';

const CATEGORY_ID = '0ef5b947-52ce-4dab-9bc7-1be54c48b3ca';

const SUBCATEGORY_ID = '768d89df-4b57-4430-b744-1b0bb9653f75';

function search() {
  return createSearchSpec({
    semanticIntent: 'мужские кроссовки',

    category: 'SHOES',

    constraints: [
      {
        attributeId: 'gender',

        operator: 'eq',

        value: 'MAN',

        unit: null,
      },
    ],
  });
}

function record() {
  const base = createConsultationApplicationRecord();

  const state = createProductConsultationState(search());

  const started = beginSearchExecution(
    base.results,

    search(),

    () => 'execution-shoes',
  );

  const results = commitSearchExecution(
    started.state,

    started.executionId,

    [
      {
        productId: PRODUCT_ONE_ID,

        title: 'First Shoe',

        price: '15000',

        image: null,
      },

      {
        productId: PRODUCT_TWO_ID,

        title: 'Second Shoe',

        price: '16000',

        image: null,
      },
    ],

    () => 'result-shoes',
  );

  return ConsultationApplicationRecordSchema.parse({
    ...base,

    revision: 2,

    generation: 1,

    state,

    results,
  });
}

function fact(input: {
  attributeId: string;

  kind: 'text' | 'number' | 'boolean' | 'set';

  value: string | number | boolean | string[];

  displayValue: string;
}) {
  return {
    attributeId: input.attributeId,

    kind: input.kind,

    unit: null,

    status: 'known' as const,

    value: input.value,

    displayValue: input.displayValue,

    provenance: [
      {
        sourceId: 'current-store',

        recordId: PRODUCT_ONE_ID,

        observedAt: '2026-09-27T00:00:00.000Z',

        updatedAt: null,

        paths: [`product.${input.attributeId}`],

        transformation: null,
      },
    ],
  };
}

function product(input: {
  id: string;

  title: string;

  brandId: string;

  brandName: string;
}): ProductDetails {
  return {
    id: input.id,

    title: input.title,

    description: 'Regression product.',

    productType: 'SHOES',

    profileId: 'SHOES',

    price: '15000',

    currency: 'RUB',

    discount: null,

    images: [],

    /**
     * Server-side availability остаётся.
     * ContextBuilder просто не публикует
     * её как recommendation fact.
     */
    availability: {
      inStock: true,

      stock: 10,
    },

    brand: {
      id: input.brandId,

      name: input.brandName,
    },

    category: {
      id: CATEGORY_ID,

      name: 'Обувь',
    },

    subcategory: {
      id: SUBCATEGORY_ID,

      name: 'Кроссовки',
    },

    attributes: [
      fact({
        attributeId: 'brand',

        kind: 'text',

        value: input.brandId,

        displayValue: input.brandName,
      }),

      fact({
        attributeId: 'category',

        kind: 'text',

        value: CATEGORY_ID,

        displayValue: 'Обувь',
      }),

      fact({
        attributeId: 'subcategory',

        kind: 'text',

        value: SUBCATEGORY_ID,

        displayValue: 'Кроссовки',
      }),

      fact({
        attributeId: 'inStock',

        kind: 'boolean',

        value: true,

        displayValue: 'true',
      }),

      fact({
        attributeId: 'stock',

        kind: 'number',

        value: 10,

        displayValue: '10',
      }),

      fact({
        attributeId: 'color',

        kind: 'text',

        value: 'белый',

        displayValue: 'Белый',
      }),
    ],

    source: {
      sourceId: 'current-store',

      recordId: input.id,

      observedAt: '2026-09-27T00:00:00.000Z',

      updatedAt: null,
    },
  };
}

function comparison(): AgentComparisonView {
  return {
    comparisonId: 'comparison-internal',

    needId: 'need-internal',

    profileId: 'SHOES',

    memoryRevision: 1,

    productIds: [PRODUCT_ONE_ID, PRODUCT_TWO_ID],

    rows: [
      {
        attributeId: 'brand',

        criterionIds: [],

        state: 'different',

        range: null,

        cells: [
          {
            productId: PRODUCT_ONE_ID,

            status: 'known',

            value: NIKE_ID,

            unit: null,

            displayValue: 'Nike',
          },

          {
            productId: PRODUCT_TWO_ID,

            status: 'known',

            value: ADIDAS_ID,

            unit: null,

            displayValue: 'Adidas',
          },
        ],
      },

      {
        /**
         * Эта row вообще не должна
         * попасть к Consultant.
         */
        attributeId: 'inStock',

        criterionIds: [],

        state: 'same',

        range: null,

        cells: [
          {
            productId: PRODUCT_ONE_ID,

            status: 'known',

            value: true,

            unit: null,

            displayValue: 'true',
          },

          {
            productId: PRODUCT_TWO_ID,

            status: 'known',

            value: true,

            unit: null,

            displayValue: 'true',
          },
        ],
      },
    ],

    requirementChecks: [],

    limitations: [],
  };
}

describe('ProductConsultationContext model-facing technical boundary', () => {
  it('replaces identity UUID fact values with semantic display values and removes availability facts', () => {
    const built = buildProductConsultationContext({
      record: record(),

      currentMessage: 'Расскажи подробнее про эти варианты',

      selectedProducts: [
        product({
          id: PRODUCT_ONE_ID,

          title: 'First Shoe',

          brandId: NIKE_ID,

          brandName: 'Nike',
        }),
      ],

      factAttributeIds: null,
    });

    expect(built.context.productFacts).toHaveLength(1);

    expect(built.context.productFacts[0]?.facts).toEqual([
      {
        attributeId: 'brand',

        status: 'known',

        value: 'Nike',

        unit: null,

        displayValue: 'Nike',
      },

      {
        attributeId: 'category',

        status: 'known',

        value: 'Обувь',

        unit: null,

        displayValue: 'Обувь',
      },

      {
        attributeId: 'subcategory',

        status: 'known',

        value: 'Кроссовки',

        unit: null,

        displayValue: 'Кроссовки',
      },

      {
        attributeId: 'color',

        status: 'known',

        value: 'белый',

        unit: null,

        displayValue: 'Белый',
      },
    ]);

    const serialized = JSON.stringify(built.context);

    expect(serialized).not.toContain(PRODUCT_ONE_ID);

    expect(serialized).not.toContain(NIKE_ID);

    expect(serialized).not.toContain(CATEGORY_ID);

    expect(serialized).not.toContain(SUBCATEGORY_ID);

    expect(
      built.context.productFacts[0]?.facts.some(
        (item) => item.attributeId === 'inStock',
      ),
    ).toBe(false);

    expect(
      built.context.productFacts[0]?.facts.some(
        (item) => item.attributeId === 'stock',
      ),
    ).toBe(false);
  });

  it('sanitizes comparison cells and drops legacy availability rows', () => {
    const built = buildProductConsultationContext({
      record: record(),

      currentMessage: 'Сравни бренды первого и второго',

      comparison: comparison(),
    });

    expect(built.context.comparison).toEqual({
      rows: [
        {
          attributeId: 'brand',

          state: 'different',

          range: null,

          cells: [
            {
              position: 1,

              status: 'known',

              value: 'Nike',

              unit: null,

              displayValue: 'Nike',
            },

            {
              position: 2,

              status: 'known',

              value: 'Adidas',

              unit: null,

              displayValue: 'Adidas',
            },
          ],
        },
      ],

      limitations: [],
    });

    const serialized = JSON.stringify(built.context.comparison);

    expect(serialized).not.toContain(PRODUCT_ONE_ID);

    expect(serialized).not.toContain(PRODUCT_TWO_ID);

    expect(serialized).not.toContain(NIKE_ID);

    expect(serialized).not.toContain(ADIDAS_ID);

    expect(serialized).not.toContain('"attributeId":"inStock"');

    expect(serialized).not.toContain('"attributeId":"stock"');
  });

  it('drops a known UUID fact when no safe semantic display value exists', () => {
    const unsafe = product({
      id: PRODUCT_ONE_ID,

      title: 'First Shoe',

      brandId: NIKE_ID,

      brandName: 'Nike',
    });

    unsafe.attributes.push(
      fact({
        attributeId: 'internalCatalogReference',

        kind: 'text',

        value: '83a194e4-bf2d-4dcf-99e4-6c8d862dc970',

        displayValue: '',
      }),
    );

    /**
     * ProductFact allows empty displayValue,
     * but the model-facing projection
     * must not emit the UUID.
     */
    const built = buildProductConsultationContext({
      record: record(),

      currentMessage: 'Что ещё известно?',

      selectedProducts: [unsafe],

      factAttributeIds: null,
    });

    expect(
      built.context.productFacts[0]?.facts.some(
        (item) => item.attributeId === 'internalCatalogReference',
      ),
    ).toBe(false);

    expect(JSON.stringify(built.context)).not.toContain(
      '83a194e4-bf2d-4dcf-99e4-6c8d862dc970',
    );
  });
});
