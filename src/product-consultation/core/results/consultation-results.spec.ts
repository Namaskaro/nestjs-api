import { describe, expect, it } from '@jest/globals';

import {
  createConsultationResultsState,
  replaceActiveResults,
  resolveProductSelection,
} from './consultation-results';

function nikeResults() {
  return [
    {
      productId: 'nike-1',

      title: 'Nike SB Dunk Low Pro',

      price: '15000',

      image: 'nike-1.webp',
    },

    {
      productId: 'nike-2',

      title: 'Nike Mind 002',

      price: '23000',

      image: 'nike-2.webp',
    },

    {
      productId: 'nike-3',

      title: 'Kobe Air Force 1 Low',

      price: '18700',

      image: 'nike-3.webp',
    },
  ];
}

function adidasResults() {
  return [
    {
      productId: 'adidas-1',

      title: 'HANDBALL SPEZIAL SHOES',

      price: '12500',

      image: 'adidas-1.webp',
    },

    {
      productId: 'adidas-2',

      title: 'Campus 00s',

      price: '12800',

      image: 'adidas-2.webp',
    },
  ];
}

describe('ConsultationResults', () => {
  it('creates empty active result state', () => {
    expect(createConsultationResultsState()).toEqual({
      version: 1,

      revision: 0,

      active: [],
    });
  });

  it('stores a new active product set', () => {
    const state = replaceActiveResults(
      createConsultationResultsState(),
      nikeResults(),
    );

    expect(state.revision).toBe(1);

    expect(state.active.map((product) => product.productId)).toEqual([
      'nike-1',
      'nike-2',
      'nike-3',
    ]);
  });

  it('new search replaces the previous active product set', () => {
    const nike = replaceActiveResults(
      createConsultationResultsState(),
      nikeResults(),
    );

    const adidas = replaceActiveResults(nike, adidasResults());

    expect(adidas.revision).toBe(2);

    expect(adidas.active.map((product) => product.productId)).toEqual([
      'adidas-1',
      'adidas-2',
    ]);

    expect(
      adidas.active.some((product) => product.productId === 'nike-1'),
    ).toBe(false);
  });

  it('zero-result search clears previous active products', () => {
    const withProducts = replaceActiveResults(
      createConsultationResultsState(),
      nikeResults(),
    );

    const zeroResult = replaceActiveResults(withProducts, []);

    expect(zeroResult.revision).toBe(2);

    expect(zeroResult.active).toEqual([]);
  });

  it('resolves ordinal positions to server-owned product IDs', () => {
    const state = replaceActiveResults(
      createConsultationResultsState(),
      adidasResults(),
    );

    const resolved = resolveProductSelection(state, {
      kind: 'positions',

      positions: [1, 2],
    });

    expect(resolved.productIds).toEqual(['adidas-1', 'adidas-2']);

    expect(resolved.products.map((product) => product.title)).toEqual([
      'HANDBALL SPEZIAL SHOES',
      'Campus 00s',
    ]);
  });

  it('resolves active selection to the whole active result set', () => {
    const state = replaceActiveResults(
      createConsultationResultsState(),
      nikeResults(),
    );

    const resolved = resolveProductSelection(state, {
      kind: 'active',
    });

    expect(resolved.productIds).toEqual(['nike-1', 'nike-2', 'nike-3']);
  });

  it('rejects an ordinal position outside the active result set', () => {
    const state = replaceActiveResults(
      createConsultationResultsState(),
      adidasResults(),
    );

    expect(() =>
      resolveProductSelection(state, {
        kind: 'positions',

        positions: [3],
      }),
    ).toThrow('position 3 is outside active product set');
  });

  it('rejects selection when active result set is empty', () => {
    expect(() =>
      resolveProductSelection(createConsultationResultsState(), {
        kind: 'active',
      }),
    ).toThrow('active product set is empty');
  });

  it('rejects duplicate product IDs in active result set', () => {
    expect(() =>
      replaceActiveResults(createConsultationResultsState(), [
        {
          productId: 'same-product',

          title: 'Product A',

          price: '100',

          image: null,
        },

        {
          productId: 'same-product',

          title: 'Product B',

          price: '200',

          image: null,
        },
      ]),
    ).toThrow();
  });
});
