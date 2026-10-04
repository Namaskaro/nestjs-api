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

function createAiService(finalText: string) {
  const stream = jest.fn((_prompt: unknown) =>
    (async function* () {
      yield {
        text: finalText,
      };
    })(),
  );

  const aiService = {
    getYandexLiteChatModel: jest.fn(() => ({
      stream,
    })),
  } as unknown as AiService;

  return {
    aiService,

    stream,
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

function promptText(prompt: unknown): string {
  const value = prompt as {
    toChatMessages: () => Array<{
      content: unknown;
    }>;
  };

  return value
    .toChatMessages()
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    )
    .join('\n');
}

const config = {} as LangGraphRunnableConfig;

describe('AggregateFinalAnswerNode product clarification', () => {
  it('appends workspace-level clarification after a cross-domain answer', async () => {
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
          message: 'Доставка выполняется курьером.',
        },
      },
    ];

    const { aiService, stream } = createAiService(
      'Доставка выполняется курьером.',
    );

    const node = createAggregateFinalAnswerNode(aiService);

    const result = (await node(
      createState({
        query: 'Покажи второй подробнее и расскажи про доставку',
        workspace,
        blocks,
      }),

      config,
    )) as Partial<SupportAgentStateType>;

    expect(result.answer?.message).toBe(
      `Доставка выполняется курьером.\n\n${question}`,
    );

    const renderedPrompt = promptText(stream.mock.calls[0][0]);

    expect(renderedPrompt).not.toContain(question);

    expect(renderedPrompt).toContain(
      'Для продолжения подбора требуется уточнение.',
    );
  });

  it('does not leak or duplicate task-level clarification when another product group succeeded', async () => {
    const question = 'Какое платье вам подобрать?';

    const workspace = createProductWorkspace();

    const blocks: SupportAgentAnswerBlock[] = [
      {
        worker: 'product_search',

        data: {
          message: `«Nike»: Найдены товары.\n\n` + `«Платье»: ${question}`,

          groups: [
            {
              taskId: 'nike',

              status: 'ready',

              query: 'Nike',

              message: 'Найдены товары.',

              products: [],

              consultation: null,
            },
            {
              taskId: 'dress',

              status: 'clarification',

              query: 'платье',

              message: question,

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
          message: 'Доставка доступна.',
        },
      },
    ];

    const { aiService, stream } = createAiService(
      'Нашёл варианты Nike. Доставка доступна.',
    );

    const node = createAggregateFinalAnswerNode(aiService);

    const result = (await node(
      createState({
        query: 'Найди Nike и платье и расскажи про доставку',
        workspace,
        blocks,
      }),

      config,
    )) as Partial<SupportAgentStateType>;

    const message = result.answer?.message ?? '';

    expect(message).toBe(
      `Нашёл варианты Nike. Доставка доступна.\n\n${question}`,
    );

    expect(message.split(question)).toHaveLength(2);

    const renderedPrompt = promptText(stream.mock.calls[0][0]);

    expect(renderedPrompt).not.toContain(question);

    expect(renderedPrompt).toContain('Найдены товары.');

    expect(renderedPrompt).toContain('Для этой подборки требуется уточнение.');
  });

  it('does not append anything when ProductAgent is not waiting for clarification', async () => {
    const workspace = createProductWorkspace();

    const blocks: SupportAgentAnswerBlock[] = [
      {
        worker: 'product_search',

        data: {
          message: 'Найдены товары.',

          groups: [
            {
              taskId: 'nike',

              status: 'ready',

              query: 'Nike',

              message: 'Найдены товары.',

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
          message: 'Доставка доступна.',
        },
      },
    ];

    const { aiService } = createAiService(
      'Нашёл товары Nike. Доставка доступна.',
    );

    const node = createAggregateFinalAnswerNode(aiService);

    const result = (await node(
      createState({
        query: 'Найди Nike и расскажи про доставку',
        workspace,
        blocks,
      }),

      config,
    )) as Partial<SupportAgentStateType>;

    expect(result.answer?.message).toBe(
      'Нашёл товары Nike. Доставка доступна.',
    );
  });
});
