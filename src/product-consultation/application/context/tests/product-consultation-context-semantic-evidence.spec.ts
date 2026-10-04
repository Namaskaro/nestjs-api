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

function consultationRecord() {
  const base = createConsultationApplicationRecord();

  const state = createProductConsultationState(shoesSearch());

  const started = beginSearchExecution(
    base.results,

    shoesSearch(),

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

    revision: 4,

    generation: 1,

    state,

    results,
  });
}

function productDetails(input: {
  id: string;

  title: string;

  price: number;
}): ProductDetails {
  const observedAt = '2026-10-01T00:00:00.000Z';

  return {
    id: input.id,

    title: input.title,

    description: `${input.title} catalog description`,

    productType: 'SHOES',

    profileId: 'SHOES',

    price: String(input.price),

    currency: 'RUB',

    discount: null,

    images: [],

    availability: {
      inStock: true,

      stock: 5,
    },

    brand: {
      id: 'brand-adidas',

      name: 'Adidas',
    },

    category: null,

    subcategory: null,

    attributes: [
      {
        attributeId: 'price',

        kind: 'number',

        unit: null,

        status: 'known',

        value: input.price,

        displayValue: `${input.price} ₽`,

        provenance: [
          {
            sourceId: 'current-store',

            recordId: input.id,

            observedAt,

            updatedAt: null,

            paths: ['price'],

            transformation: null,
          },
        ],
      },
    ],

    source: {
      sourceId: 'current-store',

      recordId: input.id,

      observedAt,

      updatedAt: null,
    },
  };
}

describe('ProductConsultationContext semantic evidence boundary', () => {
  it('projects semantic representation separately from verified product facts', () => {
    const record = consultationRecord();

    const product = productDetails({
      id: 'adidas-2',

      title: 'Campus 00s',

      price: 12800,
    });

    const semanticRepresentations = new Map([
      [
        'adidas-2',
        {
          summary:
            'Повседневные кроссовки в ретро-стилистике для городских образов.',

          targetAudience: ['Покупатели, ищущие повседневную городскую обувь'],

          styleAssociations: ['ретро', 'casual', 'streetwear'],

          useCases: ['повседневная носка', 'городские прогулки'],

          pricePositioning: 'средний ценовой сегмент',

          searchTags: [
            'adidas campus',
            'ретро кроссовки',
            'городские кроссовки',
          ],
        },
      ],
    ]);

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Что лучше для повседневной носки?',

      selectedProducts: [product],

      semanticRepresentations,

      factAttributeIds: ['price'],
    });

    expect(built.context.semanticEvidence).toEqual([
      {
        position: 2,

        summary:
          'Повседневные кроссовки в ретро-стилистике для городских образов.',

        targetAudience: ['Покупатели, ищущие повседневную городскую обувь'],

        styleAssociations: ['ретро', 'casual', 'streetwear'],

        useCases: ['повседневная носка', 'городские прогулки'],

        pricePositioning: 'средний ценовой сегмент',
      },
    ]);

    expect(built.context.productFacts).toEqual([
      {
        position: 2,

        title: 'Campus 00s',

        description: 'Campus 00s catalog description',

        profileId: 'SHOES',

        facts: [
          {
            attributeId: 'price',

            status: 'known',

            value: 12800,

            unit: null,

            displayValue: '12800 ₽',
          },
        ],
      },
    ]);

    expect(built.context.semanticEvidence[0]).not.toHaveProperty('productId');

    expect(built.context.semanticEvidence[0]).not.toHaveProperty('searchTags');

    expect(built.context.productFacts[0]).not.toHaveProperty(
      'semanticRepresentation',
    );

    expect(built.context.productFacts[0]).not.toHaveProperty(
      'semanticEvidence',
    );

    const semanticEvidenceSerialized = JSON.stringify(
      built.context.semanticEvidence,
    );

    expect(semanticEvidenceSerialized).not.toContain('adidas campus');

    expect(semanticEvidenceSerialized).not.toContain('ретро кроссовки');

    expect(semanticEvidenceSerialized).not.toContain('городские кроссовки');
  });

  it('omits semantic evidence when no representation exists for the selected product', () => {
    const record = consultationRecord();

    const product = productDetails({
      id: 'adidas-2',

      title: 'Campus 00s',

      price: 12800,
    });

    const semanticRepresentations = new Map([
      [
        'adidas-1',
        {
          summary: 'Semantic representation другого товара.',

          targetAudience: [],

          styleAssociations: [],

          useCases: [],

          pricePositioning: 'средний ценовой сегмент',

          searchTags: ['foreign semantic tag'],
        },
      ],
    ]);

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Что скажешь про второй?',

      selectedProducts: [product],

      semanticRepresentations,
    });

    expect(built.context.semanticEvidence).toEqual([]);

    expect(JSON.stringify(built.context.semanticEvidence)).not.toContain(
      'Semantic representation другого товара.',
    );

    expect(JSON.stringify(built.context.semanticEvidence)).not.toContain(
      'foreign semantic tag',
    );
  });

  it('does not expose semantic evidence when no selected products are present', () => {
    const built = buildProductConsultationContext({
      record: consultationRecord(),

      currentMessage: 'Покажи текущую подборку',

      semanticRepresentations: new Map([
        [
          'adidas-1',
          {
            summary: 'Не должно попасть в context.',

            targetAudience: [],

            styleAssociations: [],

            useCases: [],

            pricePositioning: 'средний ценовой сегмент',

            searchTags: ['hidden tag'],
          },
        ],
      ]),
    });

    expect(built.context.semanticEvidence).toEqual([]);

    expect(JSON.stringify(built.context.semanticEvidence)).not.toContain(
      'Не должно попасть в context.',
    );

    expect(JSON.stringify(built.context.semanticEvidence)).not.toContain(
      'hidden tag',
    );
  });
});
