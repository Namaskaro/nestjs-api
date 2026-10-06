import { describe, expect, it } from '@jest/globals';

import {
  normalizeProductWorkspaceModelPlan,
  ProductWorkspaceModelPlanSchema,
} from './product-workspace-model-plan';

describe('Product Workspace model plan tolerance', () => {
  it('defaults omitted clarification to null for a valid operations plan', () => {
    const parsed = ProductWorkspaceModelPlanSchema.parse({
      operations: [
        {
          kind: 'consult',

          target: {
            kind: 'new',
          },

          query: 'мужские кроссовки Adidas',

          actions: [
            {
              decision: {
                action: 'SEARCH',

                search: {
                  semanticIntent: 'мужские кроссовки Adidas',

                  category: 'SHOES',

                  constraints: [
                    {
                      attributeId: 'gender',

                      operator: 'eq',

                      value: 'мужской',
                    },

                    {
                      attributeId: 'brand',

                      operator: 'eq',

                      value: 'Adidas',
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    });

    expect(parsed.clarification).toBeNull();

    expect(parsed.operations).toHaveLength(1);
  });

  it('defaults omitted operations to an empty array for clarification', () => {
    const parsed = ProductWorkspaceModelPlanSchema.parse({
      clarification: 'Какую подборку вы имеете в виду?',
    });

    expect(parsed.operations).toEqual([]);

    expect(parsed.clarification).toBe('Какую подборку вы имеете в виду?');
  });

  it('normalizes the observed Yandex nested transport shape', () => {
    const result = normalizeProductWorkspaceModelPlan(
      {
        operations: [
          {
            actions: [
              {
                decision: {
                  action: 'SEARCH',

                  search: {
                    category: 'SHOES',

                    constraints: [
                      {
                        attributeId: 'brand',

                        operator: 'eq',

                        unit: null,

                        value: 'Adidas',
                      },

                      {
                        attributeId: 'gender',

                        operator: 'eq',

                        unit: null,

                        value: 'мужской',
                      },

                      {
                        attributeId: 'subcategory',

                        operator: 'eq',

                        unit: null,

                        value: 'кроссовки',
                      },
                    ],

                    semanticIntent: 'мужские кроссовки Adidas',
                  },

                  taskTransition: 'start_new',

                  view: 'results',
                },

                target: {
                  kind: 'new',
                },
              },
            ],
          },

          {
            actions: [
              {
                decision: {
                  action: 'SEARCH',

                  search: {
                    category: 'SHOES',

                    constraints: [
                      {
                        attributeId: 'brand',

                        operator: 'eq',

                        unit: null,

                        value: 'Nike',
                      },

                      {
                        attributeId: 'subcategory',

                        operator: 'eq',

                        unit: null,

                        value: 'кроссовки',
                      },
                    ],

                    semanticIntent: 'кроссовки Nike',
                  },

                  taskTransition: 'start_new',

                  view: 'results',
                },

                target: {
                  kind: 'new',
                },
              },
            ],
          },

          {
            actions: [
              {
                decision: {
                  action: 'SEARCH',

                  search: {
                    category: 'CLOTHES',

                    constraints: [
                      {
                        attributeId: 'gender',

                        operator: 'eq',

                        unit: null,

                        value: 'женский',
                      },

                      {
                        attributeId: 'subcategory',

                        operator: 'eq',

                        unit: null,

                        value: 'платья',
                      },
                    ],

                    semanticIntent: 'женские платья',
                  },

                  taskTransition: 'start_new',

                  view: 'results',
                },

                target: {
                  kind: 'new',
                },
              },
            ],
          },
        ],
      },

      'Найди мужские кроссовки Adidas, кроссовки Nike и женские платья',
    );

    expect(result.clarification).toBeNull();

    expect(result.operations).toHaveLength(3);

    expect(
      result.operations.map((operation) =>
        operation.kind === 'consult' ? operation.query : null,
      ),
    ).toEqual(['мужские кроссовки Adidas', 'кроссовки Nike', 'женские платья']);

    for (const operation of result.operations) {
      expect(operation.kind).toBe('consult');

      if (operation.kind !== 'consult') {
        throw new Error('Expected consult operation.');
      }

      expect(operation.target).toEqual({
        kind: 'new',
      });

      expect(operation.actions).toHaveLength(1);

      expect(operation.actions[0].decision.proposal.action).toBe('SEARCH');

      expect(operation.actions[0].decision.proposal.taskTransition).toBe(
        'start_new',
      );

      expect(operation.actions[0].view).toBe('results');
    }
  });

  it('normalizes the observed Yandex flattened operation shape', () => {
    const result = normalizeProductWorkspaceModelPlan(
      {
        clarification: null,

        operations: [
          {
            decision: {
              action: 'SHOW_RESULTS',

              selection: {
                kind: 'active',
              },

              taskTransition: 'continue',

              terminalText: null,
            },

            target: {
              kind: 'task',

              sourceText: 'мужские кроссовки Adidas',

              taskId: 'adidas-task',
            },

            view: 'results',
          },
        ],
      },

      'Найди мужские кроссовки Adidas',
    );

    expect(result.operations).toHaveLength(1);

    const operation = result.operations[0];

    expect(operation.kind).toBe('consult');

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    expect(operation.query).toBe('мужские кроссовки Adidas');

    expect(operation.target).toEqual({
      kind: 'task',

      taskId: 'adidas-task',

      sourceText: 'мужские кроссовки Adidas',
    });

    expect(operation.actions[0].decision.proposal.action).toBe('SHOW_RESULTS');

    expect(operation.actions[0].view).toBe('results');
  });

  it('still rejects conflicting targets inside one lane', () => {
    expect(() =>
      normalizeProductWorkspaceModelPlan(
        {
          operations: [
            {
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

                  target: {
                    kind: 'task',

                    taskId: 'task-a',

                    sourceText: 'Adidas',
                  },
                },

                {
                  decision: {
                    action: 'DETAILS',

                    taskTransition: 'continue',

                    selection: {
                      kind: 'positions',

                      positions: [2],
                    },
                  },

                  target: {
                    kind: 'task',

                    taskId: 'task-b',

                    sourceText: 'Nike',
                  },
                },
              ],
            },
          ],
        },

        'Покажи Adidas и Nike',
      ),
    ).toThrow(
      'ProductWorkspaceModelPlan: one lane cannot contain conflicting targets.',
    );
  });
});
