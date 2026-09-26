import { describe, expect, it } from '@jest/globals';

import { createSearchSpec } from '../../search/search-spec';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
  failSearchExecution,
} from '../consultation-results';

function nikeSearch() {
  return createSearchSpec({
    semanticIntent: 'мужские кроссовки',

    category: 'SHOES',

    constraints: [
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
        attributeId: 'brand',

        operator: 'eq',

        value: 'Adidas',

        unit: null,
      },
    ],
  });
}

describe('ConsultationResults failure marker', () => {
  it('persists the exact failed execution and SearchSpec', () => {
    const started = beginSearchExecution(
      createConsultationResultsState(),

      adidasSearch(),

      () => 'execution-adidas',
    );

    const failed = failSearchExecution(
      started.state,

      started.executionId,
    );

    expect(failed.lastFailure).toEqual({
      executionId: 'execution-adidas',

      search: adidasSearch(),
    });

    expect(failed.pendingSearch).toBeNull();

    expect(failed.active).toBeNull();
  });

  it('does not mark a successful zero-result search as failure', () => {
    const started = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-zero',
    );

    const committed = commitSearchExecution(
      started.state,

      started.executionId,

      [],

      () => 'result-zero',
    );

    expect(committed.active?.products).toEqual([]);

    expect(committed.lastFailure).toBeUndefined();
  });

  it('clears an old failure marker when a new search execution begins', () => {
    const failedStarted = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const failed = failSearchExecution(
      failedStarted.state,

      failedStarted.executionId,
    );

    expect(failed.lastFailure?.executionId).toBe('execution-nike');

    const next = beginSearchExecution(
      failed,

      adidasSearch(),

      () => 'execution-adidas',
    );

    expect(next.state.lastFailure).toBeUndefined();

    expect(next.state.pendingSearch?.executionId).toBe('execution-adidas');
  });

  it('clears failure marker after a later successful search', () => {
    const first = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const failed = failSearchExecution(
      first.state,

      first.executionId,
    );

    const second = beginSearchExecution(
      failed,

      adidasSearch(),

      () => 'execution-adidas',
    );

    const successful = commitSearchExecution(
      second.state,

      second.executionId,

      [],

      () => 'result-adidas',
    );

    expect(successful.lastFailure).toBeUndefined();

    expect(successful.active?.resultId).toBe('result-adidas');
  });
});
