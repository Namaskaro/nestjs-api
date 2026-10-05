import { describe, expect, it } from '@jest/globals';

import {
  productWorkspaceGroupMessage,
  productWorkspaceMessage,
} from '../execute-product-workspace.node';

describe('Product workspace presentation', () => {
  it('shows one generic success message for several successful product groups', () => {
    const groups = [
      {
        taskId: 'shoes',

        status: 'ready' as const,

        query: 'мужские кроссовки',

        message: '',

        products: [
          {
            id: 'shoe-1',

            title: 'Кроссовки',

            price: '1000',

            image: '',
          },
        ],

        consultation: null,
      },
      {
        taskId: 'dress',

        status: 'ready' as const,

        query: 'женское платье',

        message: '',

        products: [
          {
            id: 'dress-1',

            title: 'Платье',

            price: '2000',

            image: '',
          },
        ],

        consultation: null,
      },
    ];

    expect(productWorkspaceMessage(groups)).toBe('Нашёл подходящие варианты.');
  });

  it('hides repeated success text inside a product group', () => {
    expect(
      productWorkspaceGroupMessage({
        status: 'ready',

        showProducts: true,

        productsCount: 5,

        message: 'Нашёл подходящие варианты.',
      }),
    ).toBe('');
  });

  it('keeps clarification text inside the affected group', () => {
    expect(
      productWorkspaceGroupMessage({
        status: 'clarification',

        showProducts: false,

        productsCount: 0,

        message: 'Какой цвет платья вам нужен?',
      }),
    ).toBe('Какой цвет платья вам нужен?');
  });

  it('preserves the exact clarification question when another group succeeded', () => {
    const groups = [
      {
        taskId: 'shoes',

        status: 'ready' as const,

        query: 'мужские кроссовки',

        message: '',

        products: [
          {
            id: 'shoe-1',

            title: 'Кроссовки',

            price: '1000',

            image: '',
          },
        ],

        consultation: null,
      },
      {
        taskId: 'dress',

        status: 'clarification' as const,

        query: 'женское платье',

        message: 'Какой цвет платья вам нужен?',

        products: [],

        consultation: null,
      },
    ];

    expect(productWorkspaceMessage(groups)).toBe(
      'Часть вариантов нашёл.\n\nКакой цвет платья вам нужен?',
    );
  });
});
