import { describe, expect, it } from '@jest/globals';

import {
  action,
  harness,
  lane,
  newSearch,
  plan,
  positions,
} from './product-workspace.test-fixtures';

describe('Product workspace current-target ownership regressions', () => {
  it('closes the explicitly named dress task instead of the currently focused Nike task', async () => {
    const h = harness(
      plan(
        newSearch('мужские кроссовки Adidas'),
        newSearch('кроссовки Nike'),
        newSearch('женские платья', 'CLOTHES'),
      ),
    );

    const first = await h.run(
      'Найди мужские кроссовки Adidas, кроссовки Nike и женские платья',
    );

    const adidasTaskId = first.workspace.tasks[0].taskId;
    const nikeTaskId = first.workspace.tasks[1].taskId;
    const dressTaskId = first.workspace.tasks[2].taskId;

    h.setPlan(
      plan(
        lane(
          'Покажи второй Nike подробнее',
          [action('DETAILS', positions(2))],
          {
            kind: 'current',
            view: 'results',
          },
        ),
      ),
    );

    const focusedNike = await h.run(
      'Покажи второй Nike подробнее',
      first.workspace,
    );

    expect(focusedNike.workspace.focus).toHaveLength(1);
    expect(focusedNike.workspace.focus[0].taskId).toBe(nikeTaskId);

    h.setPlan(
      plan(
        lane('Беру рекомендуемое платье', [action('COMPLETE')], {
          kind: 'current',
          view: 'focus',
        }),
      ),
    );

    const completed = await h.run(
      'Отлично, беру рекомендуемое тобой платье, спасибо за консультацию!',
      focusedNike.workspace,
    );

    expect(completed.workspace.pendingClarification).toBeNull();

    expect(completed.workspace.tasks.map((task) => task.taskId)).toEqual([
      adidasTaskId,
      nikeTaskId,
    ]);

    expect(
      completed.workspace.tasks.some((task) => task.taskId === dressTaskId),
    ).toBe(false);

    expect(completed.workspace.focus).toHaveLength(1);
    expect(completed.workspace.focus[0].taskId).toBe(nikeTaskId);
  });

  it('routes an explicitly named Nike product across the whole workspace before falling back to dress focus', async () => {
    const h = harness(
      plan(
        newSearch('мужские кроссовки Adidas'),
        newSearch('кроссовки Nike'),
        newSearch('женские платья', 'CLOTHES'),
      ),
    );

    const first = await h.run(
      'Найди мужские кроссовки Adidas, кроссовки Nike и женские платья',
    );

    const nikeTaskId = first.workspace.tasks[1].taskId;
    const dressTaskId = first.workspace.tasks[2].taskId;

    const workspaceWithNamedNike = structuredClone(first.workspace);

    workspaceWithNamedNike.tasks[1].record.results.active!.products[1].title =
      'Nike Mind 002';

    workspaceWithNamedNike.tasks[1].record.results.lastConfirmed!.products[1].title =
      'Nike Mind 002';

    h.setPlan(
      plan(
        lane(
          'Покажи первое платье подробнее',
          [action('DETAILS', positions(1))],
          {
            kind: 'current',
            view: 'results',
          },
        ),
      ),
    );

    const focusedDress = await h.run(
      'Покажи первое платье подробнее',
      workspaceWithNamedNike,
    );

    expect(focusedDress.workspace.focus).toHaveLength(1);
    expect(focusedDress.workspace.focus[0].taskId).toBe(dressTaskId);

    h.setPlan(
      plan(
        lane(
          'Nike Mind 002 подойдёт для ежедневной ходьбы?',
          [
            action('RECOMMEND', {
              selection: {
                kind: 'active',
              },
            }),
          ],
          {
            kind: 'current',
            view: 'focus',
          },
        ),
      ),
    );

    const recommended = await h.run(
      'Nike Mind 002 подойдёт для ежедневной ходьбы?',
      focusedDress.workspace,
    );

    expect(recommended.workspace.pendingClarification).toBeNull();

    expect(recommended.groups).toHaveLength(1);
    expect(recommended.groups[0].taskId).toBe(nikeTaskId);

    expect(
      recommended.groups[0].presentations?.map(
        (presentation) => presentation.kind,
      ),
    ).toEqual(['recommendation']);

    expect(h.service.search).toHaveBeenCalledTimes(3);
  });
});
