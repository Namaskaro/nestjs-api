import { describe, expect, it } from '@jest/globals';

import { CLOTHES_PROFILE } from '../../profiles/clothes.profile';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import { createConsultationResultsState } from '../../results/consultation-results';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

function weddingSuitSearch() {
  return {
    semanticIntent: 'костюм на свадьбу',

    category: 'CLOTHES',

    constraints: [
      {
        attributeId: 'price',

        operator: 'lte' as const,

        value: 30000,

        unit: null,
      },
    ],
  };
}

describe('Pre-search CLARIFY SearchSpec', () => {
  it('persists understood executable conditions without requesting search', () => {
    const prepared = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'start_new',

        search: weddingSuitSearch(),

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'костюм на свадьбу',

            importance: 'high',

            sourceText: 'Нужен костюм на свадьбу до 30 тысяч',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: CLOTHES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'goal-wedding',
    });

    expect(prepared.turn.searchRequired).toBe(false);

    expect(prepared.turn.state.search).toEqual({
      version: 1,

      semanticIntent: 'костюм на свадьбу',

      category: 'CLOTHES',

      constraints: [
        {
          attributeId: 'price',

          operator: 'lte',

          value: 30000,

          unit: null,
        },
      ],
    });

    expect(prepared.turn.state.memory.memory.goals).toEqual([
      {
        goalId: 'goal-wedding',

        text: 'костюм на свадьбу',

        importance: 'high',

        sourceText: 'Нужен костюм на свадьбу до 30 тысяч',
      },
    ]);
  });

  it('can replace the pre-search SearchSpec during another CLARIFY while preserving task memory', () => {
    const first = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'start_new',

        search: weddingSuitSearch(),

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'костюм на свадьбу',

            importance: 'high',

            sourceText: 'Нужен костюм на свадьбу',
          },
        ],

        selection: null,

        feedback: null,
      },

      categoryProfile: CLOTHES_PROFILE,

      expectedResultId: null,

      createMemoryId: () => 'goal-wedding',
    });

    const second = prepareConsultationTurn({
      currentState: first.turn.state,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: {
          semanticIntent: 'костюм на свадьбу',

          category: 'CLOTHES',

          constraints: [
            {
              attributeId: 'price',

              operator: 'lte',

              value: 30000,

              unit: null,
            },

            {
              attributeId: 'season',

              operator: 'eq',

              value: 'SUMMER',

              unit: null,
            },
          ],
        },

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: CLOTHES_PROFILE,

      expectedResultId: null,
    });

    expect(second.turn.searchRequired).toBe(false);

    expect(second.turn.state.search?.constraints).toEqual([
      {
        attributeId: 'price',

        operator: 'lte',

        value: 30000,

        unit: null,
      },

      {
        attributeId: 'season',

        operator: 'eq',

        value: 'SUMMER',

        unit: null,
      },
    ]);

    expect(second.turn.state.memory.memory.goals).toEqual(
      first.turn.state.memory.memory.goals,
    );
  });

  it('rejects categorized conditions that do not belong to the profile', () => {
    expect(() =>
      prepareConsultationTurn({
        currentState: null,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'start_new',

          search: {
            semanticIntent: 'кроссовки',

            category: 'SHOES',

            constraints: [
              {
                /**
                 * garmentLength
                 * относится к одежде,
                 * не к SHOES.
                 */
                attributeId: 'garmentLength',

                operator: 'eq',

                value: 'LONG',

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
      }),
    ).toThrow();
  });

  it('does not allow continue CLARIFY to silently switch task category', () => {
    const shoes = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'CLARIFY',

        taskTransition: 'start_new',

        search: {
          semanticIntent: 'мужские кроссовки',

          category: 'SHOES',

          constraints: [],
        },

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(() =>
      prepareConsultationTurn({
        currentState: shoes.turn.state,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'CLARIFY',

          taskTransition: 'continue',

          search: {
            semanticIntent: 'костюм',

            category: 'CLOTHES',

            constraints: [],
          },

          searchPatch: null,

          memoryObservations: [],

          selection: null,

          feedback: null,
        },

        categoryProfile: CLOTHES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow('cannot change category from SHOES to CLOTHES through CLARIFY');
  });
});
