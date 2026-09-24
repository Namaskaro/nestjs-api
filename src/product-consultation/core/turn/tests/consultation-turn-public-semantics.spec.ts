import { describe, expect, it } from '@jest/globals';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
} from '../../results/consultation-results';

import { createProductConsultationState } from '../../state/consultation-state';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

import { ConsultationTurnProposalSchema } from '../consultation-turn-proposal.schema';

import { applyConsultationTurn } from '../consultation-turn';

function nikeSearchState() {
  return createProductConsultationState({
    semanticIntent: 'мужские кроссовки Nike',

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

function activeNikeResults() {
  const state = nikeSearchState();

  const started = beginSearchExecution(
    createConsultationResultsState(),

    state.search!,

    () => 'execution-nike',
  );

  return commitSearchExecution(
    started.state,

    started.executionId,

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

      {
        productId: 'nike-3',

        title: 'Kobe Air Force 1 Low',

        price: '18700',

        image: null,
      },
    ],

    () => 'result-nike',
  );
}

describe('Consultation public turn semantics', () => {
  it('does not expose RELAX_CONSTRAINTS to public Product Consultant', () => {
    const parsed = ConsultationTurnProposalSchema.safeParse({
      action: 'RELAX_CONSTRAINTS',

      taskTransition: 'continue',

      search: null,

      searchPatch: null,

      memoryObservations: [],

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('does not expose ALTERNATIVES to public Product Consultant', () => {
    const parsed = ConsultationTurnProposalSchema.safeParse({
      action: 'ALTERNATIVES',

      taskTransition: 'continue',

      search: null,

      searchPatch: null,

      memoryObservations: [],

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('allows five explicit positions for RECOMMEND proposal', () => {
    const parsed = ConsultationTurnProposalSchema.safeParse({
      action: 'RECOMMEND',

      taskTransition: 'continue',

      search: null,

      searchPatch: null,

      memoryObservations: [],

      selection: {
        kind: 'positions',

        positions: [1, 2, 3, 4, 5],
      },

      feedback: null,
    });

    expect(parsed.success).toBe(true);
  });

  it('empty REFINE does not request another search', () => {
    const current = nikeSearchState();

    const result = applyConsultationTurn(
      current,

      {
        action: 'REFINE',

        search: null,

        delta: {},

        selection: null,

        feedback: null,
      },
    );

    expect(result.searchRequired).toBe(false);

    expect(result.state.search).toEqual(current.search);
  });

  it('REFINE setting the same value does not request another search', () => {
    const current = nikeSearchState();

    const result = applyConsultationTurn(
      current,

      {
        action: 'REFINE',

        search: null,

        delta: {
          search: {
            set: [
              {
                attributeId: 'brand',

                operator: 'eq',

                value: 'Nike',

                unit: null,
              },
            ],

            clear: [],
          },
        },

        selection: null,

        feedback: null,
      },
    );

    expect(result.searchRequired).toBe(false);
  });

  it('REFINE with real SearchSpec change requests search', () => {
    const current = nikeSearchState();

    const result = applyConsultationTurn(
      current,

      {
        action: 'REFINE',

        search: null,

        delta: {
          search: {
            set: [
              {
                attributeId: 'brand',

                operator: 'eq',

                value: 'Adidas',

                unit: null,
              },
            ],

            clear: [],
          },
        },

        selection: null,

        feedback: null,
      },
    );

    expect(result.searchRequired).toBe(true);
  });

  it('can persist feedback while recommending different products', () => {
    const prepared = prepareConsultationTurn({
      currentState: nikeSearchState(),

      currentResults: activeNikeResults(),

      proposal: {
        /**
         * Пользователь:
         *
         * "Первый слишком массивный,
         * что из остальных посоветуешь?"
         */
        action: 'RECOMMEND',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        /**
         * Главная операция:
         * советуем из второго и третьего.
         */
        selection: {
          kind: 'positions',

          positions: [2, 3],
        },

        /**
         * Отдельное observation:
         * первый не понравился.
         */
        feedback: {
          selection: {
            kind: 'positions',

            positions: [1],
          },

          reaction: 'dislike',

          reason: 'слишком массивные',

          attributeId: null,

          sourceText: 'первый слишком массивный',
        },
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: 'result-nike',
    });

    /**
     * RECOMMEND target.
     */
    expect(prepared.resolvedSelection?.productIds).toEqual([
      'nike-2',
      'nike-3',
    ]);

    /**
     * FEEDBACK target.
     */
    expect(prepared.resolvedFeedbackSelection?.productIds).toEqual(['nike-1']);

    /**
     * Memory получила server-owned
     * productId, а не ordinal.
     */
    expect(prepared.turn.state.memory.memory.feedback).toEqual([
      {
        productId: 'nike-1',

        reaction: 'dislike',

        reason: 'слишком массивные',

        attributeId: null,

        sourceText: 'первый слишком массивный',
      },
    ]);
  });

  it('pure FEEDBACK also binds ordinal to server-owned productId', () => {
    const prepared = prepareConsultationTurn({
      currentState: nikeSearchState(),

      currentResults: activeNikeResults(),

      proposal: {
        action: 'FEEDBACK',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        /**
         * Pure feedback не имеет
         * отдельного main selection.
         */
        selection: null,

        feedback: {
          selection: {
            kind: 'positions',

            positions: [2],
          },

          reaction: 'like',

          reason: 'нравится внешний вид',

          attributeId: null,

          sourceText: 'второй нравится',
        },
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: 'result-nike',
    });

    expect(prepared.turn.state.memory.memory.feedback).toEqual([
      {
        productId: 'nike-2',

        reaction: 'like',

        reason: 'нравится внешний вид',

        attributeId: null,

        sourceText: 'второй нравится',
      },
    ]);

    expect(prepared.turn.feedback?.reaction).toBe('like');
  });
});
