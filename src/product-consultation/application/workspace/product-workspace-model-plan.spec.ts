import { describe, expect, it } from '@jest/globals';

import {
  normalizeProductWorkspaceModelPlan,
  ProductWorkspaceModelPlanSchema,
} from './product-workspace-model-plan';

describe('Product workspace model plan boundary', () => {
  it('normalizes flat workspace decisions into internal ProductConsultantDecision objects', () => {
    const result = normalizeProductWorkspaceModelPlan({
      operations: [
        {
          kind: 'consult',

          query: 'Сравни первый и второй Adidas',

          target: {
            kind: 'current',

            view: 'results',
          },

          actions: [
            {
              decision: {
                action: 'COMPARE',

                taskTransition: 'continue',

                selection: {
                  kind: 'positions',

                  positions: [1, 2],
                },
              },

              view: 'results',
            },
          ],
        },
      ],

      clarification: null,
    });

    expect(result.operations).toHaveLength(1);

    const operation = result.operations[0];

    expect(operation.kind).toBe('consult');

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    expect(operation.actions).toHaveLength(1);

    expect(operation.actions[0]).toEqual({
      decision: {
        proposal: {
          action: 'COMPARE',

          taskTransition: 'continue',

          search: null,

          searchPatch: null,

          memoryObservations: [],

          selection: {
            kind: 'positions',

            positions: [1, 2],
          },

          feedback: null,
        },

        usageScenarioIds: [],

        factAttributeIds: [],

        terminalText: null,
      },

      view: 'results',
    });
  });

  it('expands multi-position DETAILS into ordered atomic DETAILS actions', () => {
    const result = normalizeProductWorkspaceModelPlan({
      operations: [
        {
          kind: 'consult',

          query: 'Покажи подробно первое и второе платье',

          target: {
            kind: 'current',

            view: 'results',
          },

          actions: [
            {
              decision: {
                action: 'DETAILS',

                taskTransition: 'continue',

                selection: {
                  kind: 'positions',

                  positions: [1, 2],
                },
              },

              view: 'results',
            },
          ],
        },
      ],

      clarification: null,
    });

    const operation = result.operations[0];

    expect(operation.kind).toBe('consult');

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    expect(operation.actions).toHaveLength(2);

    expect(
      operation.actions.map((action) => action.decision.proposal.selection),
    ).toEqual([
      {
        kind: 'positions',

        positions: [1],
      },

      {
        kind: 'positions',

        positions: [2],
      },
    ]);

    expect(
      operation.actions.map((action) => action.decision.proposal.action),
    ).toEqual(['DETAILS', 'DETAILS']);

    expect(operation.actions.map((action) => action.view)).toEqual([
      'results',

      'results',
    ]);
  });

  it('normalizes the complete three-lane live scenario that previously failed', () => {
    const result = normalizeProductWorkspaceModelPlan({
      operations: [
        {
          kind: 'consult',

          query: 'Сравни первый и второй Adidas',

          target: {
            kind: 'current',

            view: 'results',
          },

          actions: [
            {
              decision: {
                action: 'COMPARE',

                taskTransition: 'continue',

                selection: {
                  kind: 'positions',

                  positions: [1, 2],
                },
              },

              view: 'results',
            },
          ],
        },

        {
          kind: 'consult',

          query: 'Покажи второй Nike подробнее',

          target: {
            kind: 'current',

            view: 'results',
          },

          actions: [
            {
              decision: {
                action: 'DETAILS',

                taskTransition: 'continue',

                selection: {
                  kind: 'positions',

                  positions: [2],
                },
              },

              view: 'results',
            },
          ],
        },

        {
          kind: 'consult',

          query: 'Покажи подробно первое и второе платье',

          target: {
            kind: 'current',

            view: 'results',
          },

          actions: [
            {
              decision: {
                action: 'DETAILS',

                taskTransition: 'continue',

                selection: {
                  kind: 'positions',

                  positions: [1, 2],
                },
              },

              view: 'results',
            },
          ],
        },
      ],

      clarification: null,
    });

    expect(result.operations).toHaveLength(3);

    const first = result.operations[0];

    const second = result.operations[1];

    const third = result.operations[2];

    expect(first.kind).toBe('consult');

    expect(second.kind).toBe('consult');

    expect(third.kind).toBe('consult');

    if (
      first.kind !== 'consult' ||
      second.kind !== 'consult' ||
      third.kind !== 'consult'
    ) {
      throw new Error('Expected three consult operations.');
    }

    expect(
      first.actions.map((action) => action.decision.proposal.action),
    ).toEqual(['COMPARE']);

    expect(
      second.actions.map((action) => action.decision.proposal.action),
    ).toEqual(['DETAILS']);

    expect(
      third.actions.map((action) => action.decision.proposal.action),
    ).toEqual(['DETAILS', 'DETAILS']);

    expect(
      third.actions.map((action) => action.decision.proposal.selection),
    ).toEqual([
      {
        kind: 'positions',

        positions: [1],
      },

      {
        kind: 'positions',

        positions: [2],
      },
    ]);
  });

  it('keeps already atomic DETAILS actions unchanged', () => {
    const result = normalizeProductWorkspaceModelPlan({
      operations: [
        {
          kind: 'consult',

          query: 'Покажи первый и потом третий подробнее',

          target: {
            kind: 'current',

            view: 'results',
          },

          actions: [
            {
              decision: {
                action: 'DETAILS',

                taskTransition: 'continue',

                selection: {
                  kind: 'positions',

                  positions: [1],
                },
              },

              view: 'results',
            },

            {
              decision: {
                action: 'DETAILS',

                taskTransition: 'continue',

                selection: {
                  kind: 'positions',

                  positions: [3],
                },
              },

              view: 'results',
            },
          ],
        },
      ],

      clarification: null,
    });

    const operation = result.operations[0];

    expect(operation.kind).toBe('consult');

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    expect(operation.actions).toHaveLength(2);

    expect(
      operation.actions.map((action) => action.decision.proposal.selection),
    ).toEqual([
      {
        kind: 'positions',

        positions: [1],
      },

      {
        kind: 'positions',

        positions: [3],
      },
    ]);
  });

  it('preserves internal terminal-action validation after model normalization', () => {
    expect(() =>
      normalizeProductWorkspaceModelPlan({
        operations: [
          {
            kind: 'consult',

            query: 'Нужно уточнение',

            target: {
              kind: 'current',

              view: 'results',
            },

            actions: [
              {
                decision: {
                  action: 'CLARIFY',

                  taskTransition: 'continue',
                },

                view: 'results',
              },
            ],
          },
        ],

        clarification: null,
      }),
    ).toThrow();
  });

  it('keeps workspace-level clarification without creating operations', () => {
    const result = normalizeProductWorkspaceModelPlan({
      operations: [],

      clarification: 'Какую подборку вы имеете в виду?',
    });

    expect(result).toEqual({
      operations: [],

      clarification: 'Какую подборку вы имеете в виду?',
    });
  });

  it('model-facing schema rejects the old nested proposal contract', () => {
    const result = ProductWorkspaceModelPlanSchema.safeParse({
      operations: [
        {
          kind: 'consult',

          query: 'Сравни первый и второй',

          target: {
            kind: 'current',

            view: 'results',
          },

          actions: [
            {
              decision: {
                proposal: {
                  action: 'COMPARE',

                  taskTransition: 'continue',

                  selection: {
                    kind: 'positions',

                    positions: [1, 2],
                  },
                },

                usageScenarioIds: [],

                factAttributeIds: [],

                terminalText: null,
              },

              view: 'results',
            },
          ],
        },
      ],

      clarification: null,
    });

    expect(result.success).toBe(false);
  });
});
