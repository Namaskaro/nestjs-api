import { describe, expect, it } from '@jest/globals';

import type { ProductDetails } from '../../../core/consultation-core.schema';

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

function shoesSearch() {
  return createSearchSpec({
    semanticIntent: 'мужские кроссовки для повседневной носки',

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
    ],
  });
}

function consultationRecord() {
  const base = createConsultationApplicationRecord();

  const state = createProductConsultationState(shoesSearch());

  const started = beginSearchExecution(
    base.results,

    shoesSearch(),

    () => 'execution-shoes',
  );

  const results = commitSearchExecution(
    started.state,

    started.executionId,

    [
      {
        productId: 'shoe-1',

        title: 'Test Walking Shoe',

        price: '12000',

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

function mixedFactProduct(): ProductDetails {
  const observedAt = '2026-09-26T00:00:00.000Z';

  return {
    id: 'shoe-1',

    title: 'Test Walking Shoe',

    description: 'Product used for fact status regression tests.',

    productType: 'SHOES',

    profileId: 'SHOES',

    price: '12000',

    currency: 'RUB',

    discount: null,

    images: [],

    availability: {
      inStock: true,

      stock: 5,
    },

    brand: null,

    category: null,

    subcategory: null,

    attributes: [
      {
        attributeId: 'purpose',

        kind: 'text',

        unit: null,

        status: 'known',

        value: 'повседневная обувь',

        displayValue: 'Повседневная обувь',

        provenance: [
          {
            sourceId: 'current-store',

            recordId: 'shoe-1',

            observedAt,

            updatedAt: null,

            paths: ['details.purpose'],

            transformation: null,
          },
        ],
      },

      {
        attributeId: 'upperMaterial',

        kind: 'text',

        unit: null,

        status: 'unknown',

        value: null,

        displayValue: null,

        provenance: [],
      },

      {
        attributeId: 'lining',

        kind: 'text',

        unit: null,

        status: 'conflicting',

        value: null,

        displayValue: null,

        provenance: [],
      },

      {
        attributeId: 'sole',

        kind: 'text',

        unit: null,

        status: 'not_applicable',

        value: null,

        displayValue: null,

        provenance: [],
      },
    ],

    source: {
      sourceId: 'current-store',

      recordId: 'shoe-1',

      observedAt,

      updatedAt: null,
    },
  };
}

describe('ProductConsultationContext fact status boundary', () => {
  it('preserves known, unknown, conflicting and not_applicable without inventing values', () => {
    const record = consultationRecord();

    const searchBefore = structuredClone(record.state?.search);

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Подойдут ли они для долгих прогулок?',

      usageScenarioIds: ['daily_walking'],

      selectedProducts: [mixedFactProduct()],

      factAttributeIds: ['purpose', 'upperMaterial', 'lining', 'sole'],
    });

    expect(built.context.usage?.selected).toHaveLength(1);

    expect(built.context.usage?.selected[0]).toEqual(
      expect.objectContaining({
        id: 'daily_walking',

        attributeIds: ['purpose', 'sole', 'upperMaterial', 'material'],
      }),
    );

    expect(built.context.productFacts).toHaveLength(1);

    const facts = built.context.productFacts[0]!.facts;

    expect(facts).toEqual([
      {
        attributeId: 'purpose',

        status: 'known',

        value: 'повседневная обувь',

        unit: null,

        displayValue: 'Повседневная обувь',
      },

      {
        attributeId: 'upperMaterial',

        status: 'unknown',

        value: null,

        unit: null,

        displayValue: null,
      },

      {
        attributeId: 'lining',

        status: 'conflicting',

        value: null,

        unit: null,

        displayValue: null,
      },

      {
        attributeId: 'sole',

        status: 'not_applicable',

        value: null,

        unit: null,

        displayValue: null,
      },
    ]);

    for (const fact of facts.filter((item) => item.status !== 'known')) {
      expect(fact.value).toBeNull();

      expect(fact.displayValue).toBeNull();
    }

    expect(record.state?.search).toEqual(searchBefore);

    expect(built.context.task?.search).toEqual(searchBefore);

    expect(
      built.context.task?.search?.constraints.some((constraint) =>
        ['purpose', 'sole', 'upperMaterial', 'material'].includes(
          constraint.attributeId,
        ),
      ),
    ).toBe(false);
  });

  it('does not silently drop unknown scenario-relevant facts', () => {
    const built = buildProductConsultationContext({
      record: consultationRecord(),

      currentMessage: 'Что известно про материал верха?',

      usageScenarioIds: ['daily_walking'],

      selectedProducts: [mixedFactProduct()],

      factAttributeIds: ['upperMaterial'],
    });

    expect(built.context.productFacts[0]?.facts).toEqual([
      {
        attributeId: 'upperMaterial',

        status: 'unknown',

        value: null,

        unit: null,

        displayValue: null,
      },
    ]);
  });

  it('does not resolve conflicting fact into a synthetic value', () => {
    const built = buildProductConsultationContext({
      record: consultationRecord(),

      currentMessage: 'Какая у них подкладка?',

      selectedProducts: [mixedFactProduct()],

      factAttributeIds: ['lining'],
    });

    expect(built.context.productFacts[0]?.facts[0]).toEqual({
      attributeId: 'lining',

      status: 'conflicting',

      value: null,

      unit: null,

      displayValue: null,
    });
  });

  it('keeps not_applicable distinct from unknown', () => {
    const built = buildProductConsultationContext({
      record: consultationRecord(),

      currentMessage: 'Что известно про подошву?',

      selectedProducts: [mixedFactProduct()],

      factAttributeIds: ['sole'],
    });

    expect(built.context.productFacts[0]?.facts[0]?.status).toBe(
      'not_applicable',
    );

    expect(built.context.productFacts[0]?.facts[0]?.status).not.toBe('unknown');
  });
});
