import { describe, expect, it } from '@jest/globals';

import { createSearchSpec } from '../../search/search-spec';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
  failSearchExecution,
  resolveProductSelection,
  resolveProductSelectionForAction,
  resolveProductSelectionForActionFromResult,
  resolveProductSelectionFromResult,
} from '../consultation-results';

function nikeSearch() {
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

      {
        attributeId: 'brand',

        operator: 'eq',

        value: 'Nike',

        unit: null,
      },
    ],
  });
}

function adidasSearch() {
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

      {
        attributeId: 'brand',

        operator: 'eq',

        value: 'Adidas',

        unit: null,
      },
    ],
  });
}

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

function products(count: number) {
  return Array.from(
    {
      length: count,
    },

    (_, index) => ({
      productId: `product-${index + 1}`,

      title: `Product ${index + 1}`,

      price: String(1000 + index * 100),

      image: null,
    }),
  );
}

function activeState(productCount = 3) {
  const started = beginSearchExecution(
    createConsultationResultsState(),

    nikeSearch(),

    () => 'execution-1',
  );

  return commitSearchExecution(
    started.state,

    started.executionId,

    products(productCount),

    () => 'result-1',
  );
}

describe('ConsultationResults', () => {
  it('creates empty results state', () => {
    expect(createConsultationResultsState()).toEqual({
      version: 1,

      revision: 0,

      pendingSearch: null,

      active: null,

      lastConfirmed: null,
    });
  });

  it('starts server-owned search execution', () => {
    const started = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    expect(started.executionId).toBe('execution-nike');

    expect(started.state.pendingSearch).toEqual({
      executionId: 'execution-nike',

      search: nikeSearch(),
    });

    expect(started.state.active).toBeNull();

    expect(started.state.lastConfirmed).toBeNull();
  });

  it('commits successful search into active and lastConfirmed', () => {
    const started = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const state = commitSearchExecution(
      started.state,

      started.executionId,

      nikeResults(),

      () => 'result-nike',
    );

    expect(state.pendingSearch).toBeNull();

    expect(state.active?.resultId).toBe('result-nike');

    expect(state.lastConfirmed?.resultId).toBe('result-nike');

    expect(state.active).toEqual(state.lastConfirmed);
  });

  it('new search invalidates active but preserves last confirmed result', () => {
    const first = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const nikeState = commitSearchExecution(
      first.state,

      first.executionId,

      nikeResults(),

      () => 'result-nike',
    );

    const second = beginSearchExecution(
      nikeState,

      adidasSearch(),

      () => 'execution-adidas',
    );

    expect(second.state.active).toBeNull();

    expect(second.state.lastConfirmed?.resultId).toBe('result-nike');

    expect(second.state.pendingSearch?.search).toEqual(adidasSearch());
  });

  it('technical failure preserves previous confirmed snapshot without making it active', () => {
    const nikeStarted = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const nikeState = commitSearchExecution(
      nikeStarted.state,

      nikeStarted.executionId,

      nikeResults(),

      () => 'result-nike',
    );

    const adidasStarted = beginSearchExecution(
      nikeState,

      adidasSearch(),

      () => 'execution-adidas',
    );

    const failed = failSearchExecution(
      adidasStarted.state,

      adidasStarted.executionId,
    );

    expect(failed.pendingSearch).toBeNull();

    /**
     * Нельзя выдавать Nike
     * за результат Adidas.
     */
    expect(failed.active).toBeNull();

    /**
     * Но реальная предыдущая выдача
     * не потеряна.
     */
    expect(failed.lastConfirmed?.resultId).toBe('result-nike');

    expect(
      failed.lastConfirmed?.products.map((product) => product.productId),
    ).toEqual(['nike-1', 'nike-2', 'nike-3']);
  });

  it('can explicitly resolve product from lastConfirmed after technical failure', () => {
    const nikeStarted = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const nikeState = commitSearchExecution(
      nikeStarted.state,

      nikeStarted.executionId,

      nikeResults(),

      () => 'result-nike',
    );

    const adidasStarted = beginSearchExecution(
      nikeState,

      adidasSearch(),

      () => 'execution-adidas',
    );

    const failed = failSearchExecution(
      adidasStarted.state,

      adidasStarted.executionId,
    );

    const resolved = resolveProductSelectionFromResult(
      failed,

      'result-nike',

      {
        kind: 'positions',

        positions: [2],
      },
    );

    expect(resolved.productIds).toEqual(['nike-2']);
  });

  it('ordinary resolver still refuses old result after technical failure', () => {
    const nikeStarted = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const nikeState = commitSearchExecution(
      nikeStarted.state,

      nikeStarted.executionId,

      nikeResults(),

      () => 'result-nike',
    );

    const adidasStarted = beginSearchExecution(
      nikeState,

      adidasSearch(),

      () => 'execution-adidas',
    );

    const failed = failSearchExecution(
      adidasStarted.state,

      adidasStarted.executionId,
    );

    expect(() =>
      resolveProductSelection(
        failed,

        {
          kind: 'active',
        },
      ),
    ).toThrow('active search result is missing');
  });

  it('rejects unknown explicit historical result id', () => {
    const state = activeState(3);

    expect(() =>
      resolveProductSelectionFromResult(
        state,

        'result-that-does-not-exist',

        {
          kind: 'positions',

          positions: [1],
        },
      ),
    ).toThrow('result snapshot result-that-does-not-exist is not available');
  });

  it('rejects a late result from previous search execution', () => {
    const nike = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const adidas = beginSearchExecution(
      nike.state,

      adidasSearch(),

      () => 'execution-adidas',
    );

    expect(() =>
      commitSearchExecution(
        adidas.state,

        'execution-nike',

        nikeResults(),

        () => 'late-result',
      ),
    ).toThrow('stale search execution execution-nike');

    expect(adidas.state.pendingSearch?.executionId).toBe('execution-adidas');

    expect(adidas.state.active).toBeNull();
  });

  it('accepts result from current search execution', () => {
    const nike = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const adidas = beginSearchExecution(
      nike.state,

      adidasSearch(),

      () => 'execution-adidas',
    );

    const committed = commitSearchExecution(
      adidas.state,

      'execution-adidas',

      adidasResults(),

      () => 'result-adidas',
    );

    expect(committed.active?.resultId).toBe('result-adidas');

    expect(committed.lastConfirmed?.resultId).toBe('result-adidas');
  });

  it('distinguishes successful zero-result search from technical failure', () => {
    const zeroStarted = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-zero',
    );

    const zeroResult = commitSearchExecution(
      zeroStarted.state,

      zeroStarted.executionId,

      [],

      () => 'result-zero',
    );

    expect(zeroResult.active).not.toBeNull();

    expect(zeroResult.active?.products).toEqual([]);

    expect(zeroResult.lastConfirmed?.resultId).toBe('result-zero');

    const failedStarted = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-failed',
    );

    const failed = failSearchExecution(
      failedStarted.state,

      failedStarted.executionId,
    );

    expect(failed.active).toBeNull();

    expect(failed.lastConfirmed).toBeNull();

    expect(failed.pendingSearch).toBeNull();
  });

  it('rejects stale technical failure', () => {
    const first = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-1',
    );

    const second = beginSearchExecution(
      first.state,

      adidasSearch(),

      () => 'execution-2',
    );

    expect(() =>
      failSearchExecution(
        second.state,

        'execution-1',
      ),
    ).toThrow('stale search execution execution-1');
  });

  it('resolves ordinal positions inside active snapshot', () => {
    const started = beginSearchExecution(
      createConsultationResultsState(),

      adidasSearch(),

      () => 'execution-adidas',
    );

    const state = commitSearchExecution(
      started.state,

      started.executionId,

      adidasResults(),

      () => 'result-adidas',
    );

    const resolved = resolveProductSelection(
      state,

      {
        kind: 'positions',

        positions: [1, 2],
      },
    );

    expect(resolved.resultId).toBe('result-adidas');

    expect(resolved.productIds).toEqual(['adidas-1', 'adidas-2']);
  });

  it('rejects selection without active snapshot', () => {
    expect(() =>
      resolveProductSelection(
        createConsultationResultsState(),

        {
          kind: 'active',
        },
      ),
    ).toThrow('active search result is missing');
  });

  it('rejects selection from successful empty result', () => {
    const started = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-zero',
    );

    const state = commitSearchExecution(
      started.state,

      started.executionId,

      [],

      () => 'result-zero',
    );

    expect(() =>
      resolveProductSelection(
        state,

        {
          kind: 'active',
        },
      ),
    ).toThrow('product set is empty');
  });

  it('rejects duplicate product IDs in snapshot', () => {
    const started = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-1',
    );

    expect(() =>
      commitSearchExecution(
        started.state,

        started.executionId,

        [
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
        ],

        () => 'result-1',
      ),
    ).toThrow();
  });

  it('DETAILS accepts exactly one resolved product', () => {
    const resolved = resolveProductSelectionForAction(
      activeState(3),

      'DETAILS',

      {
        kind: 'positions',

        positions: [2],
      },
    );

    expect(resolved.productIds).toEqual(['product-2']);
  });

  it('DETAILS can explicitly resolve lastConfirmed product by resultId', () => {
    const state = activeState(3);

    const resolved = resolveProductSelectionForActionFromResult(
      state,

      'DETAILS',

      'result-1',

      {
        kind: 'positions',

        positions: [2],
      },
    );

    expect(resolved.productIds).toEqual(['product-2']);
  });

  it('DETAILS rejects active selection with multiple products', () => {
    expect(() =>
      resolveProductSelectionForAction(
        activeState(3),

        'DETAILS',

        {
          kind: 'active',
        },
      ),
    ).toThrow('DETAILS requires exactly one resolved product');
  });

  it('FEEDBACK rejects active selection with multiple products', () => {
    expect(() =>
      resolveProductSelectionForAction(
        activeState(3),

        'FEEDBACK',

        {
          kind: 'active',
        },
      ),
    ).toThrow('FEEDBACK requires exactly one resolved product');
  });

  it('COMPARE rejects active selection with one product', () => {
    expect(() =>
      resolveProductSelectionForAction(
        activeState(1),

        'COMPARE',

        {
          kind: 'active',
        },
      ),
    ).toThrow('COMPARE requires 2-4 resolved products');
  });

  it('COMPARE accepts two to four products', () => {
    const resolved = resolveProductSelectionForAction(
      activeState(4),

      'COMPARE',

      {
        kind: 'active',
      },
    );

    expect(resolved.productIds).toHaveLength(4);
  });

  it('COMPARE rejects more than four products', () => {
    expect(() =>
      resolveProductSelectionForAction(
        activeState(5),

        'COMPARE',

        {
          kind: 'active',
        },
      ),
    ).toThrow('COMPARE requires 2-4 resolved products');
  });

  it('RECOMMEND accepts up to five active products', () => {
    const resolved = resolveProductSelectionForAction(
      activeState(5),

      'RECOMMEND',

      {
        kind: 'active',
      },
    );

    expect(resolved.productIds).toHaveLength(5);
  });

  it('RECOMMEND rejects more than five active products', () => {
    expect(() =>
      resolveProductSelectionForAction(
        activeState(6),

        'RECOMMEND',

        {
          kind: 'active',
        },
      ),
    ).toThrow('RECOMMEND requires 1-5 resolved products');
  });

  it('rejects unsupported action selection', () => {
    expect(() =>
      resolveProductSelectionForAction(
        activeState(2),

        'SEARCH',

        {
          kind: 'active',
        },
      ),
    ).toThrow('action SEARCH does not support product selection');
  });
});
