import { describe, expect, it } from '@jest/globals';

import {
  action,
  harness,
  lane,
  named,
  newSearch,
  plan,
  positions,
} from './product-workspace.test-fixtures';

describe('Product workspace multi-lane task routing regressions', () => {
  it('resolves three current lanes from their isolated operation queries when the full message names several tasks', async () => {
    const h = harness(
      plan(
        newSearch('кроссовки Adidas'),
        newSearch('кроссовки Nike'),
        newSearch('женское платье', 'CLOTHES'),
      ),
    );

    const first = await h.run(
      'Найди кроссовки Adidas, кроссовки Nike и женское платье',
    );

    h.setPlan(
      plan(
        lane(
          'Сравни первый и второй Adidas',
          [
            action(
              'COMPARE',

              positions(
                1,

                2,
              ),
            ),
          ],
          {
            kind: 'current',

            view: 'results',
          },
        ),

        lane(
          'Покажи второй Nike подробнее',
          [
            action(
              'DETAILS',

              positions(2),
            ),
          ],
          {
            kind: 'current',

            view: 'results',
          },
        ),

        lane(
          'Покажи подробно первое и второе платье',
          [
            action(
              'DETAILS',

              positions(1),
            ),

            action(
              'DETAILS',

              positions(2),
            ),
          ],
          {
            kind: 'current',

            view: 'results',
          },
        ),
      ),
    );

    const result = await h.run(
      'Сравни первый и второй Adidas, покажи второй Nike подробнее, а у платьев покажи подробно первое и второе',
      first.workspace,
    );

    expect(result.workspace.pendingClarification).toBeNull();

    expect(result.groups).toHaveLength(3);

    expect(
      result.groups.map((group) =>
        group.presentations?.map((presentation) => presentation.kind),
      ),
    ).toEqual([['comparison'], ['details'], ['details', 'details']]);

    expect(result.groups[0].presentations?.[0]).toMatchObject({
      kind: 'comparison',
    });

    expect(result.groups[1].presentations?.[0]).toMatchObject({
      kind: 'details',

      data: {
        product: {
          id: 'кроссовки Nike-2',
        },
      },
    });

    expect(
      result.groups[2].presentations?.map((presentation) =>
        presentation.kind === 'details' ? presentation.data.product.id : null,
      ),
    ).toEqual(['женское платье-1', 'женское платье-2']);
  });

  it('validates an explicit task source against the actual user message rather than a planner paraphrase', async () => {
    const h = harness(
      plan(
        newSearch('кроссовки'),
        newSearch('платье', 'CLOTHES'),
        newSearch('шорты', 'CLOTHES'),
      ),
    );

    const first = await h.run('Найди кроссовки, платье и шорты');

    h.setPlan(
      plan(
        lane(
          'Подробности шорт',
          [
            action(
              'DETAILS',

              positions(2),
            ),
          ],
          named(
            first.workspace,

            2,

            'шорты',
          ),
        ),
      ),
    );

    const result = await h.run('Покажи шорты подробнее', first.workspace);

    expect(result.workspace.pendingClarification).toBeNull();

    expect(result.groups).toHaveLength(1);

    expect(result.groups[0].presentations?.[0]).toMatchObject({
      kind: 'details',

      data: {
        product: {
          id: 'шорты-2',
        },
      },
    });
  });
});
