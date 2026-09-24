import { describe, expect, it } from '@jest/globals';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import { createConsultationResultsState } from '../../results/consultation-results';

import { findSearchConstraint } from '../../search/search-spec';

import { createProductConsultationState } from '../../state/consultation-state';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

function currentSearchState() {
  return createProductConsultationState({
    semanticIntent: 'мужские кроссовки Nike от 20 тысяч',

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

      {
        attributeId: 'price',

        operator: 'gte',

        value: 20000,

        unit: null,
      },
    ],
  });
}

describe('Consultation SearchSpec constraint consistency', () => {
  it('rejects REFINE that makes current numeric range impossible', () => {
    const current = currentSearchState();

    expect(() =>
      prepareConsultationTurn({
        currentState: current,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'REFINE',

          taskTransition: 'continue',

          search: null,

          /**
           * Пользователь говорит:
           *
           * "а максимум 15 тысяч"
           *
           * При этом в текущем SearchSpec
           * уже существует:
           *
           * price >= 20 000.
           */
          searchPatch: {
            set: [
              {
                attributeId: 'price',

                operator: 'lte',

                value: 15000,

                unit: null,
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
    ).toThrow(
      'numeric constraints for attribute price are contradictory: gte 20000 exceeds lte 15000',
    );

    /**
     * Boundary только построила candidate.
     *
     * Исходный authoritative state
     * не должен быть мутирован.
     */
    expect(
      findSearchConstraint(current.search!, {
        attributeId: 'price',

        operator: 'gte',
      })?.value,
    ).toBe(20000);

    expect(
      findSearchConstraint(current.search!, {
        attributeId: 'price',

        operator: 'lte',
      }),
    ).toBeNull();
  });

  it('accepts REFINE when resulting numeric range remains valid', () => {
    const current = currentSearchState();

    const prepared = prepareConsultationTurn({
      currentState: current,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          set: [
            {
              attributeId: 'price',

              operator: 'lte',

              value: 25000,

              unit: null,
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
    });

    expect(
      findSearchConstraint(prepared.turn.state.search!, {
        attributeId: 'price',

        operator: 'gte',
      })?.value,
    ).toBe(20000);

    expect(
      findSearchConstraint(prepared.turn.state.search!, {
        attributeId: 'price',

        operator: 'lte',
      })?.value,
    ).toBe(25000);

    expect(prepared.turn.searchRequired).toBe(true);
  });

  it('allows REFINE to replace conflicting lower bound before setting upper bound', () => {
    const current = currentSearchState();

    const prepared = prepareConsultationTurn({
      currentState: current,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        /**
         * Пользователь фактически
         * изменил диапазон:
         *
         * старое:
         *   price >= 20 000
         *
         * новое:
         *   price >= 10 000
         *   price <= 15 000
         */
        searchPatch: {
          set: [
            {
              attributeId: 'price',

              operator: 'gte',

              value: 10000,

              unit: null,
            },

            {
              attributeId: 'price',

              operator: 'lte',

              value: 15000,

              unit: null,
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
    });

    expect(
      findSearchConstraint(prepared.turn.state.search!, {
        attributeId: 'price',

        operator: 'gte',
      })?.value,
    ).toBe(10000);

    expect(
      findSearchConstraint(prepared.turn.state.search!, {
        attributeId: 'price',

        operator: 'lte',
      })?.value,
    ).toBe(15000);
  });
});
