import { describe, expect, it } from '@jest/globals';

import { SHOES_PROFILE } from '../../profiles/shoes.profile';

import { createConsultationResultsState } from '../../results/consultation-results';

import { findSearchConstraint } from '../../search/search-spec';

import { createProductConsultationState } from '../../state/consultation-state';

import { prepareConsultationTurn } from '../consultation-turn-boundary';

function nikeStateWithBrandInSemanticIntent() {
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

function nikeStateWithoutBrandInSemanticIntent() {
  return createProductConsultationState({
    /**
     * Brand существует только
     * как structured constraint.
     *
     * Именно к этому представлению
     * мы постепенно хотим прийти.
     */
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

describe('Consultation semanticIntent consistency', () => {
  it('rejects REFINE when old structured brand remains inside semanticIntent', () => {
    const current = nikeStateWithBrandInSemanticIntent();

    expect(() =>
      prepareConsultationTurn({
        currentState: current,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'REFINE',

          taskTransition: 'continue',

          search: null,

          searchPatch: {
            /**
             * brand реально меняется:
             *
             * Nike → Adidas
             *
             * semanticIntent специально
             * не обновляем.
             */
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

          memoryObservations: [],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow(
      'semanticIntent still contains stale structured value Nike after changing brand:eq',
    );

    /**
     * Authoritative state не мутирован.
     */
    expect(
      findSearchConstraint(
        current.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Nike');

    expect(current.search?.semanticIntent).toBe('мужские кроссовки Nike');
  });

  it('accepts REFINE when semanticIntent is refreshed to new brand', () => {
    const current = nikeStateWithBrandInSemanticIntent();

    const prepared = prepareConsultationTurn({
      currentState: current,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          semanticIntent: 'мужские кроссовки Adidas',

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

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(prepared.turn.state.search?.semanticIntent).toBe(
      'мужские кроссовки Adidas',
    );

    expect(
      findSearchConstraint(
        prepared.turn.state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Adidas');

    expect(prepared.turn.searchRequired).toBe(true);
  });

  it('accepts REFINE when structured brand is removed from semanticIntent entirely', () => {
    const current = nikeStateWithBrandInSemanticIntent();

    const prepared = prepareConsultationTurn({
      currentState: current,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          /**
           * Это даже предпочтительнее:
           *
           * semanticIntent содержит
           * semantic query,
           *
           * brand остаётся
           * structured constraint.
           */
          semanticIntent: 'мужские кроссовки',

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

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(prepared.turn.state.search?.semanticIntent).toBe(
      'мужские кроссовки',
    );

    expect(
      findSearchConstraint(
        prepared.turn.state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Adidas');
  });

  it('does not force semanticIntent rewrite when old structured value was never duplicated there', () => {
    const current = nikeStateWithoutBrandInSemanticIntent();

    const prepared = prepareConsultationTurn({
      currentState: current,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          /**
           * semanticIntent отсутствует
           * в patch — и это нормально.
           *
           * Старого Nike в semantic text
           * и так не существовало.
           */
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

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(prepared.turn.state.search?.semanticIntent).toBe(
      'мужские кроссовки',
    );

    expect(
      findSearchConstraint(
        prepared.turn.state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Adidas');
  });

  it('rejects clearing constraint while its old literal value remains in semanticIntent', () => {
    const current = nikeStateWithBrandInSemanticIntent();

    expect(() =>
      prepareConsultationTurn({
        currentState: current,

        currentResults: createConsultationResultsState(),

        proposal: {
          action: 'REFINE',

          taskTransition: 'continue',

          search: null,

          searchPatch: {
            /**
             * Пользователь:
             *
             * "бренд не важен"
             *
             * Но если semanticIntent всё ещё
             * содержит Nike, semantic retrieval
             * продолжит тянуть Nike.
             */
            set: [],

            clear: [
              {
                attributeId: 'brand',

                operator: 'eq',
              },
            ],
          },

          memoryObservations: [],

          selection: null,

          feedback: null,
        },

        categoryProfile: SHOES_PROFILE,

        expectedResultId: null,
      }),
    ).toThrow(
      'semanticIntent still contains stale structured value Nike after changing brand:eq',
    );
  });

  it('accepts clearing constraint after removing stale value from semanticIntent', () => {
    const current = nikeStateWithBrandInSemanticIntent();

    const prepared = prepareConsultationTurn({
      currentState: current,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          semanticIntent: 'мужские кроссовки',

          set: [],

          clear: [
            {
              attributeId: 'brand',

              operator: 'eq',
            },
          ],
        },

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      categoryProfile: SHOES_PROFILE,

      expectedResultId: null,
    });

    expect(
      findSearchConstraint(
        prepared.turn.state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      ),
    ).toBeNull();

    expect(prepared.turn.state.search?.semanticIntent).toBe(
      'мужские кроссовки',
    );
  });
});
