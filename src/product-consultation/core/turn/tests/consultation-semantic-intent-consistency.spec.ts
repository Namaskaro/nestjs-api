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

function nikeStateWithResidualSemanticIntent() {
  return createProductConsultationState({
    semanticIntent: 'городские кроссовки',

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
  it('accepts SEARCH when semanticIntent duplicates the same structured value', () => {
    const prepared = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: {
          /**
           * Пока допустимый compatibility case.
           *
           * Desired representation —
           * residual semanticIntent,
           * но Core не должен ломать
           * SearchSpec только из-за
           * literal duplication.
           */
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

    expect(
      findSearchConstraint(
        prepared.turn.state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Nike');
  });

  it('keeps structured constraints authoritative when semanticIntent mentions another brand', () => {
    const prepared = prepareConsultationTurn({
      currentState: null,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: {
          /**
           * Core не может детерминированно
           * доказать, что Adidas здесь —
           * именно competing brand facet.
           *
           * Поэтому текст принимается,
           * но authoritative hard brand
           * остаётся Nike.
           */
          semanticIntent: 'городские кроссовки Adidas',

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

    expect(
      findSearchConstraint(
        prepared.turn.state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Nike');

    expect(prepared.turn.state.search?.semanticIntent).toBe(
      'городские кроссовки Adidas',
    );
  });

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

  it('accepts REFINE when semanticIntent is refreshed to the new brand', () => {
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

  it('accepts brand replacement without semanticIntent rewrite when text is already residual', () => {
    const current = nikeStateWithResidualSemanticIntent();

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
      'городские кроссовки',
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

  it('allows semanticIntent-only REFINE while preserving authoritative hard constraints', () => {
    const current = nikeStateWithResidualSemanticIntent();

    const prepared = prepareConsultationTurn({
      currentState: current,

      currentResults: createConsultationResultsState(),

      proposal: {
        action: 'REFINE',

        taskTransition: 'continue',

        search: null,

        searchPatch: {
          /**
           * Именно этот класс случаев
           * был отмечен аудитом.
           *
           * Core не превращает слово Adidas
           * из свободного текста
           * в скрытый brand mutation.
           */
          semanticIntent: 'городские кроссовки Adidas',

          set: [],

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
      'городские кроссовки Adidas',
    );

    /**
     * Hard facet не изменился.
     *
     * Search adapter на следующем этапе
     * обязан реально исполнить brand=Nike
     * независимо от semantic retrieval text.
     */
    expect(
      findSearchConstraint(
        prepared.turn.state.search!,

        {
          attributeId: 'brand',

          operator: 'eq',
        },
      )?.value,
    ).toBe('Nike');

    expect(prepared.turn.searchRequired).toBe(true);
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
