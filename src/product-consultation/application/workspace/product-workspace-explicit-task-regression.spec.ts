import { describe, expect, it } from '@jest/globals';

import {
  action,
  harness,
  lane,
  newSearch,
  plan,
} from './product-workspace.test-fixtures';

import { normalizeProductWorkspaceModelPlan } from './product-workspace-model-plan';

describe('Product workspace explicit task routing regressions', () => {
  it('executes captured Yandex SHOW_RESULTS references when sibling tasks share product type words', async () => {
    const query =
      'Найди мужские кроссовки Adidas, кроссовки Nike и женские платья';

    const h = harness(
      plan(
        newSearch('мужские кроссовки Adidas'),

        newSearch('кроссовки Nike'),

        newSearch(
          'женские платья',

          'CLOTHES',
        ),
      ),
    );

    const first = await h.run(query);

    expect(first.workspace.tasks).toHaveLength(3);

    expect(h.service.search).toHaveBeenCalledTimes(3);

    const capturedYandexPlan = normalizeProductWorkspaceModelPlan(
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

              taskId: first.workspace.tasks[0].taskId,
            },

            view: 'results',
          },

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

              sourceText: 'кроссовки Nike',

              taskId: first.workspace.tasks[1].taskId,
            },

            view: 'results',
          },

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

              sourceText: 'женские платья',

              taskId: first.workspace.tasks[2].taskId,
            },

            view: 'results',
          },
        ],
      },

      query,
    );

    for (const operation of capturedYandexPlan.operations) {
      expect(operation.kind).toBe('consult');

      if (operation.kind !== 'consult') {
        throw new Error('Expected consult operation.');
      }

      expect(operation.actions[0].decision.proposal.selection).toBeNull();

      expect(operation.actions[0].decision.proposal.action).toBe(
        'SHOW_RESULTS',
      );
    }

    h.setPlan(capturedYandexPlan);

    const result = await h.run(
      query,

      first.workspace,
    );

    expect(result.workspace.pendingClarification).toBeNull();

    expect(result.groups).toHaveLength(3);

    expect(result.groups.map((group) => group.taskId)).toEqual(
      first.workspace.tasks.map((task) => task.taskId),
    );

    expect(result.groups.map((group) => group.query)).toEqual([
      'мужские кроссовки Adidas',

      'кроссовки Nike',

      'женские платья',
    ]);

    expect(result.groups.every((group) => group.products.length === 3)).toBe(
      true,
    );

    expect(h.service.search).toHaveBeenCalledTimes(3);
  });

  it('still refuses a generic task reference when two sibling tasks match equally well', async () => {
    const h = harness(
      plan(
        newSearch('кроссовки Adidas'),

        newSearch('кроссовки Nike'),
      ),
    );

    const first = await h.run('Найди кроссовки Adidas и кроссовки Nike');

    h.setPlan(
      plan(
        lane(
          'кроссовки',

          [
            action(
              'SHOW_RESULTS',

              {},

              'results',
            ),
          ],

          {
            kind: 'task',

            taskId: first.workspace.tasks[0].taskId,

            sourceText: 'кроссовки',
          },
        ),
      ),
    );

    const result = await h.run(
      'Покажи кроссовки',

      first.workspace,
    );

    expect(result.groups).toEqual([]);

    expect(result.workspace.pendingClarification?.question).toBe(
      'Какую подборку вы имеете в виду?',
    );
  });

  it('still refuses a fabricated task id when source text uniquely identifies another sibling task', async () => {
    const h = harness(
      plan(
        newSearch('кроссовки Adidas'),

        newSearch('кроссовки Nike'),
      ),
    );

    const first = await h.run('Найди кроссовки Adidas и кроссовки Nike');

    h.setPlan(
      plan(
        lane(
          'кроссовки Nike',

          [
            action(
              'SHOW_RESULTS',

              {},

              'results',
            ),
          ],

          {
            kind: 'task',

            taskId: first.workspace.tasks[0].taskId,

            sourceText: 'кроссовки Nike',
          },
        ),
      ),
    );

    const result = await h.run(
      'Покажи кроссовки Nike',

      first.workspace,
    );

    expect(result.groups).toEqual([]);

    expect(result.workspace.pendingClarification?.question).toBe(
      'Какую подборку вы имеете в виду?',
    );
  });
});
