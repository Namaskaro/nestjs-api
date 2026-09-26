import { describe, expect, it } from '@jest/globals';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
} from '../../results/consultation-results';

import { createProductConsultationState } from '../../state/consultation-state';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

function shoesSearchState() {
  return createProductConsultationState({
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

function activeShoesResults() {
  const state = shoesSearchState();

  const started = beginSearchExecution(
    createConsultationResultsState(),

    state.search!,

    () => 'execution-shoes',
  );

  return commitSearchExecution(
    started.state,

    started.executionId,

    [
      {
        productId: 'shoe-1',

        title: 'Test Shoe',

        price: '15000',

        image: null,
      },
    ],

    () => 'result-shoes',
  );
}

describe('Consultation Memory profile validation', () => {
  it('allows free-text goal before category is known', () => {
    const prepared = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'start_new',

        search: null,

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'для долгих прогулок',

            importance: 'high',

            sourceText: 'мне нужно для долгих прогулок',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: null,

      expectedResultId: null,

      createMemoryId: () => 'goal-long-walking',
    });

    expect(prepared.turn.state.memory.memory.goals).toEqual([
      {
        goalId: 'goal-long-walking',

        text: 'для долгих прогулок',

        importance: 'high',

        sourceText: 'мне нужно для долгих прогулок',
      },
    ]);
  });

  it('rejects typed Memory criterion before category is known', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: null,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'start_new',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'criterion',

              operation: 'remember',

              attributeId: 'weight',

              operator: 'lte',

              value: 0.5,

              unit: 'kg',

              importance: 'normal',

              sourceText: 'желательно полегче',
            },
          ],

          selection: null,

          feedback: null,
        },

        categoryProfile: null,

        expectedResultId: null,
      }),
    ).toThrow(
      'typed Memory criterion or feedback attribute requires a categorized task',
    );
  });

  it('rejects Memory criterion with invalid value type', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: shoesSearchState(),

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'criterion',

              operation: 'remember',

              attributeId: 'weight',

              operator: 'lte',

              value: true,

              unit: 'kg',

              importance: 'high',

              sourceText: 'хочу полегче',
            },
          ],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('attribute weight requires number value');
  });

  it('rejects Memory criterion with invalid unit', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: shoesSearchState(),

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'criterion',

              operation: 'remember',

              attributeId: 'weight',

              operator: 'lte',

              value: 400,

              unit: 'g',

              importance: 'high',

              sourceText: 'желательно до четырёхсот граммов',
            },
          ],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('attribute weight requires unit kg, received g');
  });

  it('rejects availability as a Memory criterion', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: shoesSearchState(),

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'criterion',

              operation: 'remember',

              attributeId: 'inStock',

              operator: 'eq',

              value: true,

              unit: null,

              importance: 'high',

              sourceText: 'только в наличии',
            },
          ],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('unknown attribute inStock for category SHOES');
  });

  it('rejects operator that is not allowed for Memory attribute', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: shoesSearchState(),

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'criterion',

              operation: 'remember',

              attributeId: 'brand',

              operator: 'lte',

              value: 'Nike',

              unit: null,

              importance: 'normal',

              sourceText: 'предпочитаю Nike',
            },
          ],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('operator lte is not allowed for attribute brand');
  });

  it('rejects availability as feedback attribute', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: shoesSearchState(),

        currentResults: activeShoesResults(),

        proposal: {
          action: 'FEEDBACK',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [],

          selection: null,

          feedback: {
            selection: {
              kind: 'positions',

              positions: [1],
            },

            reaction: 'dislike',

            reason: 'не подходит',

            attributeId: 'inStock',

            sourceText: 'первый не подходит',
          },
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: 'result-shoes',
      }),
    ).toThrow('unknown attribute inStock for category SHOES');
  });

  it('still accepts a valid typed soft preference', () => {
    const prepared = prepareConsultationTurn({
      currentState: shoesSearchState(),

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'criterion',

            operation: 'remember',

            attributeId: 'weight',

            operator: 'lte',

            value: 0.5,

            unit: 'kg',

            importance: 'high',

            sourceText: 'желательно полегче',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'criterion-weight',
    });

    expect(prepared.turn.state.memory.memory.criteria).toEqual([
      {
        criterionId: 'criterion-weight',

        attributeId: 'weight',

        operator: 'lte',

        value: 0.5,

        unit: 'kg',

        required: false,

        importance: 'high',

        sourceText: 'желательно полегче',
      },
    ]);
  });
});
