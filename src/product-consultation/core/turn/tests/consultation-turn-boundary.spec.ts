import { describe, expect, it } from '@jest/globals';

import {
  beginSearchExecution,
  commitSearchExecution,
  createConsultationResultsState,
} from '../../results/consultation-results';

import { createProductConsultationState } from '../../state/consultation-state';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

function nikeSearchState() {
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
  const started = beginSearchExecution(
    createConsultationResultsState(),

    nikeSearchState().search!,

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
    ],

    () => 'result-nike',
  );
}

describe('ConsultationTurnBoundary', () => {
  it('accepts valid public SEARCH proposal', () => {
    const prepared = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'continue',

        search: {
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
        },

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(prepared.turn.state.search?.category).toBe('SHOES');

    expect(prepared.turn.searchRequired).toBe(true);
  });

  it('public proposal cannot contain internal delta', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: nikeSearchState(),

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [],

          selection: null,

          feedback: null,

          delta: {
            memory: {},
          },
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow();
  });

  it('public memory observation cannot contain goalId', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: nikeSearchState(),

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'goal',

              operation: 'forget',

              text: 'повседневная носка',

              sourceText: 'это больше не важно',

              goalId: 'server-goal-id',
            },
          ],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow();
  });

  it('applies semantic goal observation through backend-owned memory patch', () => {
    const prepared = prepareConsultationTurn({
      currentState: nikeSearchState(),

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'повседневная носка',

            importance: 'normal',

            sourceText: 'нужны на каждый день',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'server-goal-id',
    });

    expect(prepared.turn.state.memory.memory.goals).toEqual([
      {
        goalId: 'server-goal-id',

        text: 'повседневная носка',

        importance: 'normal',

        sourceText: 'нужны на каждый день',
      },
    ]);
  });

  it('applies preference observation as non-required Memory criterion', () => {
    const prepared = prepareConsultationTurn({
      currentState: nikeSearchState(),

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

            sourceText: 'хочу что-нибудь полегче',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'server-criterion-id',
    });

    expect(prepared.turn.state.memory.memory.criteria).toEqual([
      {
        criterionId: 'server-criterion-id',

        attributeId: 'weight',

        operator: 'lte',

        value: 0.5,

        unit: 'kg',

        required: false,

        importance: 'high',

        sourceText: 'хочу что-нибудь полегче',
      },
    ]);
  });

  it('rejects semantically invalid SearchSpec through public boundary', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: null,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'SEARCH',

          taskTransition: 'continue',

          search: {
            semanticIntent: 'лёгкие кроссовки',

            category: 'SHOES',

            constraints: [
              {
                attributeId: 'weight',

                operator: 'lte',

                value: true,

                unit: 'kg',
              },
            ],
          },

          searchPatch: null,

          memoryObservations: [],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('attribute weight requires number value');
  });

  it('uses real normalized units from SHOES profile', () => {
    const prepared = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'continue',

        search: {
          semanticIntent: 'лёгкие кроссовки',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'weight',

              operator: 'lte',

              value: 0.5,

              unit: 'kg',
            },
          ],
        },

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(prepared.turn.state.search?.constraints[0]).toEqual({
      attributeId: 'weight',

      operator: 'lte',

      value: 0.5,

      unit: 'kg',
    });
  });

  it('rejects category replacement through REFINE', () => {
    const current = nikeSearchState();

    expect(() =>
      prepareConsultationTurn({
        currentState: current,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'REFINE',

          taskTransition: 'continue',

          search: null,

          searchPatch: {
            category: 'DRESS',

            set: [],

            clear: [],
          },

          memoryObservations: [],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('cannot change category from SHOES to DRESS through REFINE');

    expect(current.search?.category).toBe('SHOES');
  });

  it('rejects invalid REFINE constraint through public boundary', () => {
    const current = nikeSearchState();

    expect(() =>
      prepareConsultationTurn({
        currentState: current,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'REFINE',

          taskTransition: 'continue',

          search: null,

          searchPatch: {
            set: [
              {
                attributeId: 'weight',

                operator: 'lte',

                value: false,

                unit: 'kg',
              },
            ],

            clear: [],
          },

          memoryObservations: [],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('attribute weight requires number value');

    expect(
      current.search?.constraints.some(
        (constraint) => constraint.attributeId === 'weight',
      ),
    ).toBe(false);
  });

  it('rejects invalid product position before semantic memory observation is applied', () => {
    const current = nikeSearchState();

    const originalMemory = structuredClone(current.memory);

    expect(() =>
      prepareConsultationTurn({
        currentState: current,

        currentResults: activeNikeResults(),

        proposal: {
          action: 'DETAILS',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [
            {
              kind: 'goal',

              operation: 'remember',

              text: 'повседневная носка',

              importance: 'normal',

              sourceText: 'нужны на каждый день',
            },
          ],

          selection: {
            kind: 'positions',

            positions: [25],
          },

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: 'result-nike',

        createMemoryId: () => 'goal-should-not-exist',
      }),
    ).toThrow('position 25 is outside product set');

    expect(current.memory).toEqual(originalMemory);

    expect(current.memory.memory.goals).toEqual([]);
  });

  it('rejects ordinal reference when expected result snapshot is unavailable', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: nikeSearchState(),

        currentResults: activeNikeResults(),

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

        expectedResultId: 'older-result',
      }),
    ).toThrow('result snapshot older-result is not available');
  });

  it('resolves ordinal reference against expected server snapshot', () => {
    const prepared = prepareConsultationTurn({
      currentState: nikeSearchState(),

      currentResults: activeNikeResults(),

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

    expect(prepared.resolvedSelection?.resultId).toBe('result-nike');

    expect(prepared.resolvedSelection?.productIds).toEqual(['nike-2']);
  });

  it('requires server-owned resultId for product selection', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: nikeSearchState(),

        currentResults: activeNikeResults(),

        proposal: {
          action: 'DETAILS',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [],

          selection: {
            kind: 'positions',

            positions: [1],
          },

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('product selection requires expectedResultId');
  });
});
