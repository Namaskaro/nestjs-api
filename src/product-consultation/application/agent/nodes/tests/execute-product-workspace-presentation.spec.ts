import { describe, expect, it } from '@jest/globals';

import {
  productWorkspaceGroupMessage,
  productWorkspaceMessage,
} from '../execute-product-workspace.node';

describe('Product workspace presentation', () => {
  const presented = (query: string) => ({
    taskId: query,
    query,
    status: 'ready' as const,
    products: [],
    message: `Рекомендация для ${query}`,
    presentations: [
      {
        actionOrdinal: 0,
        kind: 'recommendation' as const,
        message: 'Рекомендация',
        productIds: ['product-1'],
      },
    ],
    consultation: null,
  });

  it('uses one compact message for several successful structured action groups', () => {
    expect(
      productWorkspaceMessage([
        presented('кроссовки'),
        presented('платье'),
        presented('шорты'),
      ]),
    ).toBe('Готово.');
  });

  it('does not repeat task names or presentation text when cards and actions coexist', () => {
    const shoes = {
      ...presented('кроссовки'),
      products: [
        { id: 'shoe-1', title: 'Кроссовки', price: '1000', image: '' },
      ],
    };
    expect(productWorkspaceMessage([shoes, presented('платье')])).toBe(
      'Нашёл подходящие варианты.',
    );
  });

  it('retains necessary recovery and clarification questions without describing every result group', () => {
    const question = 'Можно снять ограничение по цвету?';
    const recovery = {
      ...presented('зелёные Nike'),
      status: 'empty' as const,
      presentations: [],
      message: question,
      recovery: {
        resultId: 'empty-result',
        options: [
          {
            clear: { attributeId: 'color', operator: 'eq' as const },
            label: 'Цвет = зелёные',
          },
        ],
        question,
      },
    };
    const clarification = {
      ...presented('шорты'),
      status: 'clarification' as const,
      presentations: [],
      message: 'Какой размер вам нужен?',
    };
    expect(
      productWorkspaceMessage([presented('платье'), recovery, clarification]),
    ).toBe(`${question}\n\nКакой размер вам нужен?`);
  });

  it('keeps a technical failure visible alongside recovery without listing successful groups', () => {
    const question = 'Какое условие можно изменить?';
    const recovery = {
      ...presented('кроссовки'),
      status: 'empty' as const,
      presentations: [],
      message: question,
      recovery: { resultId: 'empty-result', options: [], question },
    };
    const failed = {
      ...presented('шорты'),
      status: 'failed' as const,
      presentations: [],
      message: 'Ошибка поиска',
    };
    const result = productWorkspaceMessage([
      presented('платье'),
      recovery,
      failed,
    ]);
    expect(result).toBe(`Часть действий выполнить не удалось.\n\n${question}`);
  });

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
