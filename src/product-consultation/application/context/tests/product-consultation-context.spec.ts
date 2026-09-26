import { describe, expect, it } from '@jest/globals';

import {
  createConsultationApplicationRecord,
  ConsultationApplicationRecordSchema,
} from '../../runtime/consultation-application-record';

import {
  beginSearchExecution,
  commitSearchExecution,
  failSearchExecution,
} from '../../../core/results/consultation-results';

import { createSearchSpec } from '../../../core/search/search-spec';

import { createProductConsultationState } from '../../../core/state/consultation-state';

import type { ProductDetails } from '../../../core/consultation-core.schema';

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

function productDetails(input: {
  id: string;

  title: string;

  price: number;
}): ProductDetails {
  const observedAt = '2026-09-25T12:00:00.000Z';

  return {
    id: input.id,

    title: input.title,

    description: `${input.title} description`,

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

      {
        attributeId: 'sizes',

        kind: 'set',

        unit: null,

        status: 'known',

        value: ['40', '41', '42'],

        displayValue: '40, 41, 42',

        provenance: [
          {
            sourceId: 'current-store',

            recordId: input.id,

            observedAt,

            updatedAt: null,

            paths: ['sizes'],

            transformation: null,
          },
        ],
      },

      {
        /**
         * Проверяем, что unknown
         * передаётся модели именно
         * как unknown, а не исчезает
         * или превращается в догадку.
         */
        attributeId: 'weight',

        kind: 'number',

        unit: 'kg',

        status: 'unknown',

        value: null,

        displayValue: null,

        provenance: [],
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

    revision: 4,

    generation: 1,

    state,

    results,
  });
}

describe('ProductConsultationContext', () => {
  it('builds compact LLM context while keeping revision and resultId server-owned', () => {
    const record = activeRecord();

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Сравни первый и второй',

      recentMessages: [
        {
          role: 'user',

          text: 'старое сообщение 1',
        },

        {
          role: 'assistant',

          text: 'старое сообщение 2',
        },

        {
          role: 'user',

          text: 'старое сообщение 3',
        },

        {
          role: 'assistant',

          text: 'старое сообщение 4',
        },

        {
          role: 'user',

          text: 'старое сообщение 5',
        },

        {
          role: 'assistant',

          text: 'старое сообщение 6',
        },

        {
          role: 'user',

          text: 'последнее сообщение',
        },
      ],
    });

    /**
     * Server metadata находится
     * рядом с context, а не внутри
     * модельного payload.
     */
    expect(built.expectedRevision).toBe(4);

    expect(built.expectedResultId).toBe('result-adidas');

    expect(built.context).not.toHaveProperty('expectedRevision');

    expect(built.context).not.toHaveProperty('expectedResultId');

    expect(built.context.recentMessages).toHaveLength(6);

    expect(built.context.recentMessages[0]?.text).toBe('старое сообщение 2');

    expect(built.context.recentMessages[5]?.text).toBe('последнее сообщение');

    expect(built.context.results.status).toBe('active');

    /**
     * Модель видит order,
     * но не реальные productIds.
     */
    expect(built.context.results.shownProducts).toEqual([
      {
        position: 1,

        title: 'HANDBALL SPEZIAL SHOES',

        price: '12500',

        image: null,
      },

      {
        position: 2,

        title: 'Campus 00s',

        price: '12800',

        image: null,
      },
    ]);

    expect(built.context.results.shownProducts[0]).not.toHaveProperty(
      'productId',
    );

    expect(built.context.task?.search).toEqual(adidasSearch());

    expect(built.context.profile?.id).toBe('SHOES');

    expect(built.context.profile?.guidance.length).toBeGreaterThan(0);
  });

  it('only exposes verified facts belonging to the bound snapshot', () => {
    const record = activeRecord();

    const campus = productDetails({
      id: 'adidas-2',

      title: 'Campus 00s',

      price: 12800,
    });

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Покажи второй подробнее',

      selectedProducts: [campus],

      factAttributeIds: ['price', 'weight'],
    });

    expect(built.context.productFacts).toEqual([
      {
        position: 2,

        title: 'Campus 00s',

        profileId: 'SHOES',

        facts: [
          {
            attributeId: 'price',

            status: 'known',

            value: 12800,

            unit: null,

            displayValue: '12800 ₽',
          },

          {
            attributeId: 'weight',

            status: 'unknown',

            value: null,

            unit: 'kg',

            displayValue: null,
          },
        ],
      },
    ]);

    /**
     * Никакой provenance,
     * stock или internal ID
     * в LLM fact projection нет.
     */
    expect(built.context.productFacts[0]).not.toHaveProperty('id');

    expect(built.context.productFacts[0]).not.toHaveProperty('availability');
  });

  it('rejects facts for a product outside the bound result snapshot', () => {
    const record = activeRecord();

    expect(() =>
      buildProductConsultationContext({
        record,

        currentMessage: 'Что скажешь про этот товар?',

        selectedProducts: [
          productDetails({
            id: 'foreign-product',

            title: 'Foreign product',

            price: 10000,
          }),
        ],
      }),
    ).toThrow(
      'product foreign-product does not belong to the bound result snapshot',
    );
  });

  it('reports technical failure without silently exposing lastConfirmed products', () => {
    const record = activeRecord();

    const nextSearch = createSearchSpec({
      semanticIntent: 'зелёные мужские кроссовки Adidas',

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

        {
          attributeId: 'color',

          operator: 'eq',

          value: 'зелёный',

          unit: null,
        },
      ],
    });

    const started = beginSearchExecution(
      record.results,

      nextSearch,

      () => 'execution-green',
    );

    const failed = failSearchExecution(
      started.state,

      started.executionId,
    );

    const failedRecord = ConsultationApplicationRecordSchema.parse({
      ...record,

      revision: 6,

      state: createProductConsultationState(nextSearch),

      results: failed,
    });

    const built = buildProductConsultationContext({
      record: failedRecord,

      currentMessage: 'Ну и что нашлось?',
    });

    expect(built.context.results.status).toBe('failure');

    expect(built.context.results.hasLastConfirmed).toBe(true);

    /**
     * Failure не означает:
     * "автоматически покажи старый
     * Adidas snapshot".
     */
    expect(built.expectedResultId).toBeNull();

    expect(built.context.results.shownProducts).toEqual([]);

    /**
     * Но application может явно
     * вернуть старый snapshot
     * в context отдельным решением.
     */
    const withPrevious = buildProductConsultationContext({
      record: failedRecord,

      currentMessage: 'Вернись к прошлой выдаче',

      referenceResultId: 'result-adidas',
    });

    expect(withPrevious.expectedResultId).toBe('result-adidas');

    expect(withPrevious.context.results.shownProducts).toHaveLength(2);
  });

  it('builds an idle context before search exists', () => {
    const record = createConsultationApplicationRecord();

    const built = buildProductConsultationContext({
      record,

      currentMessage: 'Помоги подобрать что-нибудь',
    });

    expect(built.expectedRevision).toBe(0);

    expect(built.expectedResultId).toBeNull();

    expect(built.context.task).toBeNull();

    expect(built.context.results.status).toBe('idle');

    expect(built.context.results.shownProducts).toEqual([]);

    expect(built.context.profile).toBeNull();
  });
});
