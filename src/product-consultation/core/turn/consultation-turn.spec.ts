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

function nikeSearch() {
  return {
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
  };
}

function initialNikeTurn() {
  return {
    action: 'SEARCH' as const,

    search: nikeSearch(),

    delta: {},

    selection: null,

    feedback: null,
  };
}

describe('ConsultationTurn', () => {
  it('allows CLARIFY before the first search', () => {
    const result = applyConsultationTurn(
      null,

      {
        action: 'CLARIFY',

        search: null,

        delta: {},

        selection: null,

        feedback: null,
      },
    );

    expect(result.action).toBe('CLARIFY');

    expect(result.searchRequired).toBe(false);

    expect(result.state.search).toBeNull();
  });

  it('can store memory during pre-search clarification', () => {
    const result = applyConsultationTurn(
      null,

      {
        action: 'CLARIFY',

        search: null,

        delta: {
          memory: {
            ...emptyMemoryPatch(),

            goals: {
              add: [
                {
                  text: 'ежедневная ходьба',

                  importance: 'high',

                  sourceText: 'я много хожу каждый день',
                },
              ],

              update: [],

              remove: [],
            },
          },
        },

        selection: null,

        feedback: null,
      },

      () => 'goal-walking',
    );

    expect(result.state.search).toBeNull();

    expect(result.state.memory.memory.goals[0]?.text).toBe('ежедневная ходьба');
  });

  it('first SEARCH preserves memory collected by CLARIFY', () => {
    const clarified = applyConsultationTurn(
      null,

      {
        action: 'CLARIFY',

        search: null,

        delta: {
          memory: {
            ...emptyMemoryPatch(),

            goals: {
              add: [
                {
                  text: 'ежедневная ходьба',

                  importance: 'high',

                  sourceText: 'много хожу',
                },
              ],

              update: [],

              remove: [],
            },
          },
        },

        selection: null,

        feedback: null,
      },

      () => 'goal-walking',
    );

    const started = applyConsultationTurn(
      clarified.state,

      initialNikeTurn(),
    );

    expect(started.searchRequired).toBe(true);

    expect(started.state.memory.memory.goals[0]?.text).toBe(
      'ежедневная ходьба',
    );
  });

  it('creates consultation directly from SEARCH', () => {
    const result = applyConsultationTurn(null, initialNikeTurn());

    expect(result.searchRequired).toBe(true);

    expect(result.state.search?.category).toBe('SHOES');

    expect(
      findSearchConstraint(result.state.search!, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Nike');
  });

  it('rejects REFINE before search exists', () => {
    expect(() =>
      applyConsultationTurn(
        null,

        {
          action: 'REFINE',

          search: null,

          delta: {
            search: {
              set: [],

              clear: [],
            },
          },

          selection: null,

          feedback: null,
        },
      ),
    ).toThrow('REFINE requires an existing SearchSpec');
  });

  it('rejects ALTERNATIVES before search exists', () => {
    expect(() =>
      applyConsultationTurn(
        null,

        {
          action: 'ALTERNATIVES',

          search: null,

          delta: {},

          selection: null,

          feedback: null,
        },
      ),
    ).toThrow('ALTERNATIVES requires an existing SearchSpec');
  });

  it('REFINE patches current SearchSpec', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const refined = applyConsultationTurn(
      first.state,

      {
        action: 'REFINE',

        search: null,

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
        },

        selection: null,

        feedback: null,
      },
    );

    expect(
      findSearchConstraint(refined.state.search!, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Nike');

    expect(
      findSearchConstraint(refined.state.search!, {
        attributeId: 'color',

        operator: 'eq',
      })?.value,
    ).toBe('зелёный');
  });

  it('new SEARCH completely replaces previous SearchSpec', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const next = applyConsultationTurn(
      first.state,

      {
        action: 'SEARCH',

        search: {
          semanticIntent: 'ноутбук для разработки',

          category: 'LAPTOP',

          constraints: [
            {
              attributeId: 'brand',

              operator: 'eq',

              value: 'Lenovo',

              unit: null,
            },
          ],
        },

        delta: {},

        selection: null,

        feedback: null,
      },
    );

    expect(next.state.search?.category).toBe('LAPTOP');

    expect(
      findSearchConstraint(next.state.search!, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Lenovo');

    expect(
      findSearchConstraint(next.state.search!, {
        attributeId: 'gender',

        operator: 'eq',
      }),
    ).toBeNull();
  });

  it('new independent SEARCH resets old task memory', () => {
    const first = applyConsultationTurn(
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

                  sourceText: 'на каждый день',
                },
              ],

              update: [],

              remove: [],
            },
          },
        },
      },

      () => 'goal-shoes',
    );

    expect(first.state.memory.memory.goals).toHaveLength(1);

    const laptop = applyConsultationTurn(
      first.state,

      {
        action: 'SEARCH',

        search: {
          semanticIntent: 'ноутбук для разработки',

          category: 'LAPTOP',

          constraints: [],
        },

        delta: {},

        selection: null,

        feedback: null,
      },
    );

    expect(laptop.state.memory.memory).toEqual({
      goals: [],
      criteria: [],
      feedback: [],
    });
  });

  it('new SEARCH can store memory for the new task after reset', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const laptop = applyConsultationTurn(
      first.state,

      {
        action: 'SEARCH',

        search: {
          semanticIntent: 'ноутбук для разработки',

          category: 'LAPTOP',

          constraints: [],
        },

        delta: {
          memory: {
            ...emptyMemoryPatch(),

            goals: {
              add: [
                {
                  text: 'разработка',

                  importance: 'high',

                  sourceText: 'нужен для разработки',
                },
              ],

              update: [],

              remove: [],
            },
          },
        },

        selection: null,

        feedback: null,
      },

      () => 'goal-development',
    );

    expect(laptop.state.memory.memory.goals).toEqual([
      {
        goalId: 'goal-development',

        text: 'разработка',

        importance: 'high',

        sourceText: 'нужен для разработки',
      },
    ]);
  });

  it('rejects SEARCH without complete SearchSpec', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'SEARCH',

      search: null,

      delta: {},

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects SEARCH with SearchSpec patch', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'SEARCH',

      search: nikeSearch(),

      delta: {
        search: {
          set: [],

          clear: [],
        },
      },

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects full SearchSpec on REFINE', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'REFINE',

      search: nikeSearch(),

      delta: {},

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('RECOMMEND cannot mutate SearchSpec', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    expect(() =>
      applyConsultationTurn(
        first.state,

        {
          action: 'RECOMMEND',

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

          selection: {
            kind: 'active',
          },

          feedback: null,
        },
      ),
    ).toThrow();

    expect(
      findSearchConstraint(first.state.search!, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Nike');
  });

  it('COMPARE keeps ordinal selection without productId', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const compare = applyConsultationTurn(
      first.state,

      {
        action: 'COMPARE',

        search: null,

        delta: {},

        selection: {
          kind: 'positions',

          positions: [1, 2],
        },

        feedback: null,
      },
    );

    expect(compare.selection).toEqual({
      kind: 'positions',

      positions: [1, 2],
    });

    expect(compare.searchRequired).toBe(false);
  });

  it('accepts semantic FEEDBACK without productId', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    const feedback = applyConsultationTurn(
      first.state,

      {
        action: 'FEEDBACK',

        search: null,

        delta: {},

        selection: {
          kind: 'positions',

          positions: [1],
        },

        feedback: {
          reaction: 'dislike',

          reason: 'слишком массивные',

          attributeId: null,

          sourceText: 'первые слишком массивные',
        },
      },
    );

    expect(feedback.feedback?.reaction).toBe('dislike');

    expect(feedback.state.memory.memory.feedback).toEqual([]);
  });

  it('rejects arbitrary productId through memory feedback patch', () => {
    const first = applyConsultationTurn(null, initialNikeTurn());

    expect(() =>
      applyConsultationTurn(
        first.state,

        {
          action: 'FEEDBACK',

          search: null,

          delta: {
            memory: {
              ...emptyMemoryPatch(),

              feedback: {
                upsert: [
                  {
                    productId: 'invented-product',

                    reaction: 'dislike',

                    reason: 'не нравится',

                    attributeId: null,

                    sourceText: 'не нравится',
                  },
                ],

                remove: [],
              },
            },
          },

          selection: {
            kind: 'positions',

            positions: [1],
          },

          feedback: {
            reaction: 'dislike',

            reason: 'не нравится',

            attributeId: null,

            sourceText: 'не нравится',
          },
        },
      ),
    ).toThrow();
  });

  it('rejects productId inside semantic feedback', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'FEEDBACK',

      search: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1],
      },

      feedback: {
        productId: 'invented-product',

        reaction: 'like',

        reason: null,

        attributeId: null,

        sourceText: 'мне нравится первый',
      },
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects compare with one position', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'COMPARE',

      search: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1],
      },

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects DETAILS with multiple positions', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'DETAILS',

      search: null,

      delta: {},

      selection: {
        kind: 'positions',

        positions: [1, 2],
      },

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects legacy planner control fields', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'REFINE',

      search: null,

      delta: {},

      selection: null,

      feedback: null,

      needIndex: 1,

      reuseNeedIndexes: [2],

      brandMode: 'required',
    });

    expect(parsed.success).toBe(false);
  });
});
