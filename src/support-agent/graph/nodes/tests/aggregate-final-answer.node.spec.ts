import { describe, expect, it, jest } from '@jest/globals';

import { HumanMessage } from '@langchain/core/messages';

import type { LangGraphRunnableConfig } from '@langchain/langgraph';

import type { AiService } from '@/src/ai/ai.service';

import { createProductWorkspace } from '@/src/product-consultation/application/workspace/product-workspace';

import type { SupportAgentAnswerBlock } from '@/src/support-agent/schemas/support-agent-answer.schema';

import { createAggregateFinalAnswerNode } from '../aggregate-final-answer.node';

import type { SupportAgentStateType } from '../../support-agent.state';

jest.mock('@langchain/core/callbacks/dispatch', () => ({
  dispatchCustomEvent: jest.fn(async () => undefined),
}));

function createAiService() {
  const getYandexLiteChatModel = jest.fn(() => {
    throw new Error('AggregateFinalAnswerNode must not call LLM.');
  });

  return {
    aiService: {
      getYandexLiteChatModel,
    } as unknown as AiService,

    getYandexLiteChatModel,
  };
}

function createState(input: {
  query: string;

  workspace: ReturnType<typeof createProductWorkspace>;

  blocks: SupportAgentAnswerBlock[];
}): SupportAgentStateType {
  return {
    query: input.query,

    messages: [new HumanMessage(input.query)],

    preIntentRoute: 'requestRouterNode',

    rejectCount: 0,

    clarification: null,

    requestRouter: null,

    activeAgent: 'productAgent',

    productContext: null,

    productWorkspace: input.workspace,

    productConsultationRecord: null,

    executionMode: 'multi',

    workerResults: input.blocks,

    handoffRequest: null,

    handoff: null,

    answer: null,
  };
}

const config = {} as LangGraphRunnableConfig;

describe('AggregateFinalAnswerNode', () => {
  it('keeps empty product search and customer help as separate semantic sections', async () => {
    const workspace = createProductWorkspace();

    const blocks: SupportAgentAnswerBlock[] = [
      {
        worker: 'product_search',

        data: {
          message: 'По вашему запросу подходящих товаров не найдено.',

          groups: [
            {
              taskId: 'shoes',

              status: 'empty',

              query: 'зелёные Nike',

              message: 'По вашему запросу подходящих товаров не найдено.',

              products: [],

              consultation: null,
            },
          ],

          consultation: null,

          consultationCompletion: null,
        },
      },
      {
        worker: 'customer_help',

        data: {
          message: 'Доставка курьером занимает от двух дней.',
        },
      },
    ];

    const {
      aiService,

      getYandexLiteChatModel,
    } = createAiService();

    const node = createAggregateFinalAnswerNode(aiService);

    const result = (await node(
      createState({
        query: 'Найди зелёные Nike и расскажи про доставку',

        workspace,

        blocks,
      }),

      config,
    )) as Partial<SupportAgentStateType>;

    expect(result.answer?.message).toBe(
      [
        'Товары:',
        'По вашему запросу подходящих товаров не найдено.',
        '',
        'Информация магазина:',
        'Доставка курьером занимает от двух дней.',
      ].join('\n'),
    );

    expect(getYandexLiteChatModel).not.toHaveBeenCalled();
  });

  it('appends a product clarification exactly once and keeps it separate from customer help', async () => {
    const question = 'Какую подборку вы имеете в виду?';

    const workspace = createProductWorkspace();

    workspace.pendingClarification = {
      query: 'Покажи второй подробнее',

      question,
    };

    const blocks: SupportAgentAnswerBlock[] = [
      {
        worker: 'product_search',

        data: {
          message: question,

          groups: [],

          consultation: null,

          consultationCompletion: null,
        },
      },
      {
        worker: 'customer_help',

        data: {
          message: 'Доставка доступна.',
        },
      },
    ];

    const {
      aiService,

      getYandexLiteChatModel,
    } = createAiService();

    const node = createAggregateFinalAnswerNode(aiService);

    const result = (await node(
      createState({
        query: 'Покажи второй подробнее и расскажи про доставку',

        workspace,

        blocks,
      }),

      config,
    )) as Partial<SupportAgentStateType>;

    const message = result.answer?.message ?? '';

    expect(message).toBe(
      [
        'Товары:',
        question,
        '',
        'Информация магазина:',
        'Доставка доступна.',
      ].join('\n'),
    );

    expect(message.split(question)).toHaveLength(2);

    expect(getYandexLiteChatModel).not.toHaveBeenCalled();
  });

  it('keeps product, order and store information in stable independent sections', async () => {
    const workspace = createProductWorkspace();

    const blocks: SupportAgentAnswerBlock[] = [
      {
        worker: 'customer_help',

        data: {
          message: 'Оплата картой доступна.',
        },
      },
      {
        worker: 'order',

        data: {
          message: 'Заказ передан в доставку.',
        },
      },
      {
        worker: 'product_search',

        data: {
          message: 'Нашёл подходящие варианты.',

          groups: [
            {
              taskId: 'nike',

              status: 'ready',

              query: 'Nike',

              message: '',

              products: [
                {
                  id: 'nike-1',

                  title: 'Nike',

                  price: '1000',

                  image: '',
                },
              ],

              consultation: null,
            },
          ],

          consultation: null,

          consultationCompletion: null,
        },
      },
    ];

    const {
      aiService,

      getYandexLiteChatModel,
    } = createAiService();

    const node = createAggregateFinalAnswerNode(aiService);

    const result = (await node(
      createState({
        query: 'Найди Nike, расскажи про заказ и оплату',

        workspace,

        blocks,
      }),

      config,
    )) as Partial<SupportAgentStateType>;

    expect(result.answer?.message).toBe(
      [
        'Товары:',
        'Нашёл подходящие варианты.',
        '',
        'Заказ:',
        'Заказ передан в доставку.',
        '',
        'Информация магазина:',
        'Оплата картой доступна.',
      ].join('\n'),
    );

    expect(getYandexLiteChatModel).not.toHaveBeenCalled();
  });
});
