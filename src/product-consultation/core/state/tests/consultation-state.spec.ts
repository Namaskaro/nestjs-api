import { describe, expect, it } from '@jest/globals';
import {
  applyConsultationStateDelta,
  createProductConsultationState,
} from '../consultation-state';
import { findSearchConstraint } from '../../search/search-spec';

function emptyMemoryPatch() {
  return {
    goals: {
      add: [],
      update: [],
      remove: [],
    },

    criteria: {
      add: [],
      update: [],
      remove: [],
    },

    feedback: {
      upsert: [],
      remove: [],
    },
  };
}

function createInitialState() {
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

describe('ProductConsultationState', () => {
  it('combines SearchSpec and Memory into one authoritative state', () => {
    const state = createInitialState();

    expect(state.version).toBe(1);

    expect(state.search.semanticIntent).toBe('мужские кроссовки');

    expect(state.memory).toEqual({
      version: 1,

      revision: 0,

      memory: {
        goals: [],
        criteria: [],
        feedback: [],
      },
    });
  });

  it('T2 can change search and memory in the same turn', () => {
    const current = createInitialState();

    const next = applyConsultationStateDelta(
      current,
      {
        search: {
          set: [
            {
              attributeId: 'color',

              operator: 'eq',

              value: 'зелёный',

              unit: null,
            },
          ],

          clear: [],
        },

        memory: {
          ...emptyMemoryPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-daily-wear',
    );

    expect(
      findSearchConstraint(next.search, {
        attributeId: 'color',

        operator: 'eq',
      })?.value,
    ).toBe('зелёный');

    expect(next.memory.memory.goals).toEqual([
      {
        goalId: 'goal-daily-wear',

        text: 'повседневная носка',

        importance: 'normal',

        sourceText: 'для повседневной носки',
      },
    ]);

    expect(next.memory.revision).toBe(1);
  });

  it('T3 changes only Nike to Adidas and preserves everything else', () => {
    const afterT2 = applyConsultationStateDelta(
      createInitialState(),
      {
        search: {
          set: [
            {
              attributeId: 'color',

              operator: 'eq',

              value: 'зелёный',

              unit: null,
            },
          ],

          clear: [],
        },

        memory: {
          ...emptyMemoryPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-daily-wear',
    );

    /**
     * "Окей, тогда Adidas"
     */
    const afterT3 = applyConsultationStateDelta(afterT2, {
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
    });

    expect(
      findSearchConstraint(afterT3.search, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Adidas');

    expect(
      findSearchConstraint(afterT3.search, {
        attributeId: 'gender',

        operator: 'eq',
      })?.value,
    ).toBe('MAN');

    expect(
      findSearchConstraint(afterT3.search, {
        attributeId: 'color',

        operator: 'eq',
      })?.value,
    ).toBe('зелёный');

    expect(afterT3.memory.memory.goals[0]?.text).toBe('повседневная носка');

    /**
     * Search-only turn:
     * memory revision не меняется.
     */
    expect(afterT3.memory.revision).toBe(1);
  });

  it('T4 clears only color and preserves Adidas, gender and daily-wear goal', () => {
    let state = createInitialState();

    state = applyConsultationStateDelta(
      state,
      {
        search: {
          set: [
            {
              attributeId: 'color',

              operator: 'eq',

              value: 'зелёный',

              unit: null,
            },
          ],

          clear: [],
        },

        memory: {
          ...emptyMemoryPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-daily-wear',
    );

    state = applyConsultationStateDelta(state, {
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
    });

    /**
     * "Ладно, цвет не важен"
     */
    state = applyConsultationStateDelta(state, {
      search: {
        set: [],

        clear: [
          {
            attributeId: 'color',

            operator: 'eq',
          },
        ],
      },
    });

    expect(
      findSearchConstraint(state.search, {
        attributeId: 'color',

        operator: 'eq',
      }),
    ).toBeNull();

    expect(
      findSearchConstraint(state.search, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Adidas');

    expect(
      findSearchConstraint(state.search, {
        attributeId: 'gender',

        operator: 'eq',
      })?.value,
    ).toBe('MAN');

    expect(state.memory.memory.goals[0]?.text).toBe('повседневная носка');

    expect(state.memory.revision).toBe(1);
  });

  it('does nothing when turn has no state delta', () => {
    const current = createInitialState();

    const next = applyConsultationStateDelta(current, {});

    expect(next).toEqual(current);
  });

  it('does not allow external code to control memory revision', () => {
    const current = createInitialState();

    expect(() =>
      applyConsultationStateDelta(
        current,

        {
          expectedRevision: 999,

          search: {
            set: [],

            clear: [],
          },
        } as never,
      ),
    ).toThrow();
  });
});
