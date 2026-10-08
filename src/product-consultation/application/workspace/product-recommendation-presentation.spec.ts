import { describe, expect, it } from '@jest/globals';

import {
  action,
  harness,
  lane,
  plan,
  positions,
} from './product-workspace.test-fixtures';

describe('Product recommendation presentation', () => {
  it('returns only a recommendation presentation with the product chosen by synthesis', async () => {
    const h = harness();

    const first = await h.run();

    h.respond.mockResolvedValueOnce({
      message: 'Для ежедневной ходьбы я бы выбрал второй вариант.',

      recommendedPosition: 2,
    });

    h.setPlan(
      plan(
        lane('Посоветуй из первых двух', [
          action('RECOMMEND', positions(1, 2)),
        ]),
      ),
    );

    const result = await h.run(
      'Что из первых двух лучше для ежедневной ходьбы?',
      first.workspace,
    );

    expect(result.groups).toHaveLength(1);

    expect(result.groups[0].presentations).toHaveLength(1);

    expect(result.groups[0].presentations?.[0]).toMatchObject({
      kind: 'recommendation',

      message: 'Для ежедневной ходьбы я бы выбрал второй вариант.',

      productIds: ['кроссовки-2'],

      product: {
        id: 'кроссовки-2',

        title: 'кроссовки 2',

        price: '1000',

        image: '/product-2.jpg',
      },
    });
  });
});
