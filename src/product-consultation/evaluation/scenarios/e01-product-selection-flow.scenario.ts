import {
  EvaluationScenarioSchema,
  type EvaluationScenario,
} from '../contracts/evaluation-scenario';

export const E01_PRODUCT_SELECTION_FLOW: EvaluationScenario =
  EvaluationScenarioSchema.parse({
    id: 'E01',

    title:
      'Multi-turn search, recovery, comparison, recommendation and completion',

    description:
      'Поиск → уточнение → zero-result → смена бренда → ослабление ограничения → сравнение → рекомендация → details → выбор → feedback.',

    target: 'product_consultation',

    fixtureId: null,

    initialState: null,

    turns: [
      {
        id: 'T1',
        kind: 'message',
        message: 'Найди мне мужские кроссовки Nike',
        messageId: 'eval-e01-t1',
      },

      {
        id: 'T2',
        kind: 'message',
        message: 'Хочу зелёные, для повседневной носки',
        messageId: 'eval-e01-t2',
      },

      {
        id: 'T3',
        kind: 'message',
        message: 'Окей, тогда Adidas',
        messageId: 'eval-e01-t3',
      },

      {
        id: 'T4',
        kind: 'message',
        message: 'Ладно, цвет не важен',
        messageId: 'eval-e01-t4',
      },

      {
        id: 'T5',
        kind: 'message',
        message: 'Сравни первый и второй варианты',
        messageId: 'eval-e01-t5',
      },

      {
        id: 'T6',
        kind: 'message',
        message: 'Какой из них ты бы посоветовал для повседневной носки?',
        messageId: 'eval-e01-t6',
      },

      {
        id: 'T7',
        kind: 'message',
        message: 'Покажи первый вариант подробнее',
        messageId: 'eval-e01-t7',
      },

      {
        id: 'T8',
        kind: 'message',
        message: 'Всё, беру этот, спасибо',
        messageId: 'eval-e01-t8',
      },
    ],

    checks: [
      {
        id: 'no-runtime-errors',
        evaluator: 'no-errors',
        description: 'Весь сценарий проходит без технических ошибок.',
        params: {},
      },

      {
        id: 't1-search',
        evaluator: 'tool-call-count',
        description: 'Первичный запрос запускает один поиск.',
        params: {
          turnId: 'T1',
          name: 'search_products',
          exact: 1,
        },
      },

      {
        id: 't1-gender',
        evaluator: 'json-value',
        description: 'Поиск сохраняет мужской пол.',
        params: {
          turnId: 'T1',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.gender',
          equals: 'MAN',
        },
      },

      {
        id: 't1-brand',
        evaluator: 'json-value',
        description: 'Первичный поиск использует Nike.',
        params: {
          turnId: 'T1',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.brand',
          equals: 'Nike',
        },
      },

      {
        id: 't2-search',
        evaluator: 'tool-call-count',
        description: 'Добавление новых условий запускает новый поиск.',
        params: {
          turnId: 'T2',
          name: 'search_products',
          exact: 1,
        },
      },

      {
        id: 't2-search-results',
        evaluator: 'artifact',
        description:
          'После уточнения действительно выполнен поиск и создан search_results.',
        params: {
          turnId: 'T2',
          kind: 'search_results',
          exact: 1,
        },
      },

      {
        id: 't2-zero-results',
        evaluator: 'json-value',
        description:
          'Выполненный Nike + green поиск действительно вернул zero-result.',
        params: {
          turnId: 'T2',
          source: 'artifact',
          artifactKind: 'search_results',
          path: 'count',
          equals: 0,
        },
      },

      {
        id: 't2-brand-preserved',
        evaluator: 'json-value',
        description: 'После уточнения сохраняется Nike.',
        params: {
          turnId: 'T2',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.brand',
          equals: 'Nike',
        },
      },

      {
        id: 't2-gender-preserved',
        evaluator: 'json-value',
        description: 'После уточнения сохраняется MAN.',
        params: {
          turnId: 'T2',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.gender',
          equals: 'MAN',
        },
      },

      {
        id: 't2-color-added',
        evaluator: 'json-value',
        description: 'В поиск добавлено ограничение по цвету.',
        params: {
          turnId: 'T2',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.color',
          notNull: true,
        },
      },

      {
        id: 't3-search',
        evaluator: 'tool-call-count',
        description: 'Смена бренда запускает новый поиск.',
        params: {
          turnId: 'T3',
          name: 'search_products',
          exact: 1,
        },
      },

      {
        id: 't3-brand-changed',
        evaluator: 'json-value',
        description: 'Nike заменён на Adidas.',
        params: {
          turnId: 'T3',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.brand',
          equals: 'Adidas',
        },
      },

      {
        id: 't3-gender-preserved',
        evaluator: 'json-value',
        description: 'При смене бренда сохраняется MAN.',
        params: {
          turnId: 'T3',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.gender',
          equals: 'MAN',
        },
      },

      {
        id: 't3-color-preserved',
        evaluator: 'json-value',
        description: 'При смене бренда цвет не теряется.',
        params: {
          turnId: 'T3',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.color',
          notNull: true,
        },
      },

      {
        id: 't4-search',
        evaluator: 'tool-call-count',
        description: 'Явное снятие цвета запускает новый поиск.',
        params: {
          turnId: 'T4',
          name: 'search_products',
          exact: 1,
        },
      },

      {
        id: 't4-search-results',
        evaluator: 'artifact',
        description:
          'После снятия цвета выполнен поиск и создана товарная выдача.',
        params: {
          turnId: 'T4',
          kind: 'search_results',
          exact: 1,
        },
      },

      {
        id: 't4-brand-preserved',
        evaluator: 'json-value',
        description: 'После снятия цвета сохраняется Adidas.',
        params: {
          turnId: 'T4',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.brand',
          equals: 'Adidas',
        },
      },

      {
        id: 't4-gender-preserved',
        evaluator: 'json-value',
        description: 'После снятия цвета сохраняется MAN.',
        params: {
          turnId: 'T4',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.gender',
          equals: 'MAN',
        },
      },

      {
        id: 't4-color-cleared',
        evaluator: 'json-value',
        description: 'Пользователь явно снял ограничение по цвету.',
        params: {
          turnId: 'T4',
          source: 'tool_call',
          toolName: 'search_products',
          path: 'constraints.color',
          equals: null,
        },
      },

      {
        id: 't5-no-search',
        evaluator: 'tool-call-count',
        description: 'Сравнение показанных товаров не запускает новый поиск.',
        params: {
          turnId: 'T5',
          name: 'search_products',
          exact: 0,
        },
      },

      {
        id: 't5-comparison',
        evaluator: 'artifact',
        description: 'Создан comparison artifact.',
        params: {
          turnId: 'T5',
          kind: 'comparison',
          exact: 1,
        },
      },

      {
        id: 't6-no-search',
        evaluator: 'tool-call-count',
        description:
          'Рекомендация между известными товарами не запускает поиск.',
        params: {
          turnId: 'T6',
          name: 'search_products',
          exact: 0,
        },
      },

      {
        id: 't7-no-search',
        evaluator: 'tool-call-count',
        description: 'Details существующего товара не запускает новый поиск.',
        params: {
          turnId: 'T7',
          name: 'search_products',
          exact: 0,
        },
      },

      {
        id: 't7-details-read',
        evaluator: 'tool-call-count',
        description: 'Для подробностей читаются Product Details.',
        params: {
          turnId: 'T7',
          name: 'get_product_details',
          min: 1,
        },
      },

      {
        id: 't7-details-artifact',
        evaluator: 'artifact',
        description: 'Создан product_details artifact.',
        params: {
          turnId: 'T7',
          kind: 'product_details',
          exact: 1,
        },
      },

      {
        id: 't8-no-search',
        evaluator: 'tool-call-count',
        description: 'Завершение консультации не запускает поиск.',
        params: {
          turnId: 'T8',
          name: 'search_products',
          exact: 0,
        },
      },

      {
        id: 't8-completion',
        evaluator: 'artifact',
        description: 'Выбор товара завершает консультацию.',
        params: {
          turnId: 'T8',
          kind: 'consultation_completion',
          exact: 1,
        },
      },

      {
        id: 't8-feedback-kind',
        evaluator: 'json-value',
        description: 'После завершения запрашивается helpfulness feedback.',
        params: {
          turnId: 'T8',
          source: 'artifact',
          artifactKind: 'consultation_completion',
          path: 'feedbackRequest.kind',
          equals: 'HELPFULNESS',
        },
      },

      {
        id: 't8-feedback-options',
        evaluator: 'json-value',
        description: 'Пользователю доступны 👍/👎 варианты feedback.',
        params: {
          turnId: 'T8',
          source: 'artifact',
          artifactKind: 'consultation_completion',
          path: 'feedbackRequest.options',
          equals: ['HELPFUL', 'NOT_HELPFUL'],
        },
      },
    ],

    tags: [
      'baseline',
      'live',
      'multi-turn',
      'search',
      'zero-result',
      'context-retention',
      'comparison',
      'recommendation',
      'details',
      'completion',
      'feedback',
    ],
  });
