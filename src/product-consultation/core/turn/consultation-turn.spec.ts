import { describe, expect, it } from '@jest/globals';

import { findSearchConstraint } from '../search/search-spec';

import { applyConsultationTurn } from './consultation-turn';

import { ConsultationTurnInterpretationSchema } from './consultation-turn.schema';

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

function initialNikeTurn() {
  return {
    action: 'SEARCH' as const,

    initialSearch: {
      semanticIntent: 'мужские кроссовки',

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
    },

    delta: {},

    selection: null,
  };
}

describe('ConsultationTurn', () => {
  it('creates consultation from the first SEARCH turn', () => {
    const result = applyConsultationTurn(null, initialNikeTurn());

    expect(result.action).toBe('SEARCH');

    expect(result.searchRequired).toBe(true);

    expect(result.selection).toBeNull();

    expect(
      findSearchConstraint(result.state.search, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Nike');

    expect(
      findSearchConstraint(result.state.search, {
        attributeId: 'gender',

        operator: 'eq',
      })?.value,
    ).toBe('MAN');
  });

  it('first SEARCH can also store a user goal', () => {
    const result = applyConsultationTurn(
      null,

      {
        ...initialNikeTurn(),

        delta: {
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
      },

      () => 'goal-daily-wear',
    );

    expect(result.state.memory.memory.goals[0]).toEqual({
      goalId: 'goal-daily-wear',

      text: 'повседневная носка',

      importance: 'normal',

      sourceText: 'для повседневной носки',
    });
  });

  it('rejects a non-SEARCH action as the first turn', () => {
    expect(() =>
      applyConsultationTurn(null, {
        action: 'COMPARE',

        initialSearch: null,

        delta: {},

        selection: {
          kind: 'positions',

          positions: [1, 2],
        },
      }),
    ).toThrow('first turn must start with SEARCH');
  });

  it('T2 refines search and stores daily-wear goal', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const t2 = applyConsultationTurn(
      first.state,

      {
        action: 'REFINE',

        initialSearch: null,

        delta: {
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

        selection: null,
      },

      () => 'goal-daily-wear',
    );

    expect(t2.searchRequired).toBe(true);

    expect(
      findSearchConstraint(t2.state.search, {
        attributeId: 'color',

        operator: 'eq',
      })?.value,
    ).toBe('зелёный');

    expect(t2.state.memory.memory.goals[0]?.text).toBe('повседневная носка');
  });

  it('T3 changes only Nike to Adidas', () => {
    let state = applyConsultationTurn(null, initialNikeTurn()).state;

    state = applyConsultationTurn(
      state,

      {
        action: 'REFINE',

        initialSearch: null,

        delta: {
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

        selection: null,
      },

      () => 'goal-daily-wear',
    ).state;

    const t3 = applyConsultationTurn(state, {
      action: 'REFINE',

      initialSearch: null,

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
    });

    expect(
      findSearchConstraint(t3.state.search, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Adidas');

    expect(
      findSearchConstraint(t3.state.search, {
        attributeId: 'gender',

        operator: 'eq',
      })?.value,
    ).toBe('MAN');

    expect(
      findSearchConstraint(t3.state.search, {
        attributeId: 'color',

        operator: 'eq',
      })?.value,
    ).toBe('зелёный');

    expect(t3.state.memory.memory.goals[0]?.text).toBe('повседневная носка');
  });

  it('T4 explicitly relaxes only color', () => {
    let state = applyConsultationTurn(null, initialNikeTurn()).state;

    state = applyConsultationTurn(state, {
      action: 'REFINE',

      initialSearch: null,

      delta: {
        search: {
          set: [
            {
              attributeId: 'brand',

              operator: 'eq',

              value: 'Adidas',

              unit: null,
            },

            {
              attributeId: 'color',

              operator: 'eq',

              value: 'зелёный',

              unit: null,
            },
          ],

          clear: [],
        },
      },

      selection: null,
    }).state;

    const t4 = applyConsultationTurn(state, {
      action: 'RELAX_CONSTRAINTS',

      initialSearch: null,

      delta: {
        search: {
          set: [],

          clear: [
            {
              attributeId: 'color',

              operator: 'eq',
            },
          ],
        },
      },

      selection: null,
    });

    expect(t4.searchRequired).toBe(true);

    expect(
      findSearchConstraint(t4.state.search, {
        attributeId: 'color',

        operator: 'eq',
      }),
    ).toBeNull();

    expect(
      findSearchConstraint(t4.state.search, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Adidas');
  });

  it('ALTERNATIVES requests a search without requiring a state rewrite', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const alternatives = applyConsultationTurn(first.state, {
      action: 'ALTERNATIVES',

      initialSearch: null,

      delta: {},

      selection: null,
    });

    expect(alternatives.searchRequired).toBe(true);

    expect(alternatives.state).toEqual(first.state);

    expect(alternatives.selection).toBeNull();
  });

  it('COMPARE does not trigger product search', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const compare = applyConsultationTurn(first.state, {
      action: 'COMPARE',

      initialSearch: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1, 2],
      },
    });

    expect(compare.searchRequired).toBe(false);

    expect(compare.state).toEqual(first.state);

    expect(compare.selection).toEqual({
      kind: 'positions',

      positions: [1, 2],
    });
  });

  it('RECOMMEND does not trigger product search', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const recommend = applyConsultationTurn(first.state, {
      action: 'RECOMMEND',

      initialSearch: null,

      delta: {},

      selection: {
        kind: 'active',
      },
    });

    expect(recommend.searchRequired).toBe(false);

    expect(recommend.state).toEqual(first.state);

    expect(recommend.selection).toEqual({
      kind: 'active',
    });
  });

  it('DETAILS does not trigger product search', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const details = applyConsultationTurn(first.state, {
      action: 'DETAILS',

      initialSearch: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1],
      },
    });

    expect(details.searchRequired).toBe(false);

    expect(details.state).toEqual(first.state);

    expect(details.selection).toEqual({
      kind: 'positions',

      positions: [1],
    });
  });

  it('preserves ordinal references without exposing product IDs', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const compare = applyConsultationTurn(first.state, {
      action: 'COMPARE',

      initialSearch: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1, 2],
      },
    });

    expect(compare.selection).toEqual({
      kind: 'positions',

      positions: [1, 2],
    });
  });

  it('rejects compare with only one product', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'COMPARE',

      initialSearch: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects DETAILS with more than one product', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'DETAILS',

      initialSearch: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1, 2],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects action requiring selection when selection is missing', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'COMPARE',

      initialSearch: null,

      delta: {},

      selection: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects selection for SEARCH action', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'SEARCH',

      initialSearch: {
        semanticIntent: 'мужские кроссовки',

        category: 'SHOES',

        constraints: [],
      },

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects legacy planner control fields', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'REFINE',

      initialSearch: null,

      delta: {},

      selection: null,

      needIndex: 1,

      reuseNeedIndexes: [2],

      brandMode: 'required',
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects initialSearch after consultation already exists', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    expect(() => applyConsultationTurn(first.state, initialNikeTurn())).toThrow(
      'initialSearch is allowed only for the first turn',
    );
  });
});
