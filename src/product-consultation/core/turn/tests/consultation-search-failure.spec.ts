import { describe, expect, it } from '@jest/globals';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
  failSearchExecution,
} from '../../results/consultation-results';

import { createSearchSpec } from '../../search/search-spec';

import { createProductConsultationState } from '../../state/consultation-state';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

function nikeSearchDraft() {
  return {
    semanticIntent: 'мужские кроссовки Nike',

    category: 'SHOES',

    constraints: [
      {
        attributeId: 'gender',

        operator: 'eq' as const,

        value: 'MAN',

        unit: null,
      },

      {
        attributeId: 'brand',

        operator: 'eq' as const,

        value: 'Nike',

        unit: null,
      },
    ],
  };
}

function adidasSearchDraft() {
  return {
    semanticIntent: 'мужские кроссовки Adidas',

    category: 'SHOES',

    constraints: [
      {
        attributeId: 'gender',

        operator: 'eq' as const,

        value: 'MAN',

        unit: null,
      },

      {
        attributeId: 'brand',

        operator: 'eq' as const,

        value: 'Adidas',

        unit: null,
      },
    ],
  };
}

function nikeSearch() {
  return createSearchSpec(nikeSearchDraft());
}

function adidasSearch() {
  return createSearchSpec(adidasSearchDraft());
}

describe('Consultation search failure', () => {
  it('preserves previous confirmed products without presenting them as failed search result', () => {
    const nikeStarted = beginSearchExecution(
      createConsultationResultsState(),

      nikeSearch(),

      () => 'execution-nike',
    );

    const nikeResults = commitSearchExecution(
      nikeStarted.state,

      nikeStarted.executionId,

      [
        {
          productId: 'nike-1',

          title: 'Nike SB Dunk Low Pro',

          price: '15000',

          image: null,
        },

        {
          productId: 'nike-2',

          title: 'Nike Mind 002',

          price: '23000',

          image: null,
        },
      ],

      () => 'result-nike',
    );

    const adidasStarted = beginSearchExecution(
      nikeResults,

      adidasSearch(),

      () => 'execution-adidas',
    );

    const failed = failSearchExecution(
      adidasStarted.state,

      adidasStarted.executionId,
    );

    expect(failed.active).toBeNull();

    expect(failed.lastConfirmed?.resultId).toBe('result-nike');

    /**
     * Текущая consultation task
     * уже относится к Adidas.
     *
     * createProductConsultationState()
     * принимает SearchSpecDraft,
     * поэтому сюда передаём draft,
     * а не SearchSpec с version.
     */
    const currentState = createProductConsultationState(adidasSearchDraft());

    /**
     * Пользователь явно возвращается
     * к предыдущей подтверждённой
     * Nike выдаче:
     *
     * "А у второго Nike
     * какие подробности?"
     *
     * expectedResultId задаёт backend,
     * не LLM.
     */
    const prepared = prepareConsultationTurn({
      currentState,

      currentResults: failed,

      proposal: {
        action: 'DETAILS',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: {
          kind: 'positions',

          positions: [2],
        },

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: 'result-nike',
    });

    expect(prepared.resolvedSelection?.productIds).toEqual(['nike-2']);

    /**
     * Обсуждение старого Nike
     * НЕ переключает текущую
     * search task обратно на Nike.
     */
    expect(
      prepared.turn.state.search?.constraints.find(
        (constraint) => constraint.attributeId === 'brand',
      )?.value,
    ).toBe('Adidas');
  });
});
