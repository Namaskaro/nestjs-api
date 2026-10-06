import { describe, expect, it } from '@jest/globals';

import { normalizeProductWorkspaceModelPlan } from './product-workspace-model-plan';

describe('Product workspace completion boundary', () => {
  it('normalizes the captured Yandex COMPLETE shape without model-owned taskTransition or target', () => {
    const plan = normalizeProductWorkspaceModelPlan(
      {
        clarification: null,

        operations: [
          {
            actions: [
              {
                decision: {
                  action: 'COMPLETE',

                  taskTransition: 'complete',
                },

                view: null,
              },
            ],
          },
        ],
      },

      'Отлично, беру рекомендуемое тобой платье, спасибо за консультацию!',
    );

    expect(plan.clarification).toBeNull();

    expect(plan.operations).toHaveLength(1);

    const operation = plan.operations[0];

    expect(operation.kind).toBe('consult');

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    expect(operation.target).toEqual({
      kind: 'current',

      view: 'focus',
    });

    expect(operation.query).toBe(
      'Отлично, беру рекомендуемое тобой платье, спасибо за консультацию!',
    );

    expect(operation.actions).toHaveLength(1);

    expect(operation.actions[0].decision.proposal.action).toBe('COMPLETE');

    expect(operation.actions[0].decision.proposal.taskTransition).toBe(
      'continue',
    );

    expect(operation.actions[0].decision.terminalText).toBe(
      'Спасибо за консультацию. Если понадобится помощь с выбором — обращайтесь.',
    );
  });

  it('derives start_new only for the first SEARCH of a new lane', () => {
    const plan = normalizeProductWorkspaceModelPlan(
      {
        operations: [
          {
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

                    constraints: [],
                  },
                },

                view: 'results',
              },

              {
                decision: {
                  action: 'DETAILS',

                  selection: {
                    kind: 'positions',

                    positions: [1],
                  },
                },

                view: 'results',
              },
            ],
          },
        ],
      },

      'Найди Adidas и покажи первый подробнее',
    );

    const operation = plan.operations[0];

    if (operation.kind !== 'consult') {
      throw new Error('Expected consult operation.');
    }

    expect(operation.actions[0].decision.proposal.taskTransition).toBe(
      'start_new',
    );

    expect(operation.actions[1].decision.proposal.taskTransition).toBe(
      'continue',
    );
  });
});
