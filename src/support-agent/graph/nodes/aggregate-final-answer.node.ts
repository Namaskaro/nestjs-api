import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';

import { AIMessage } from '@langchain/core/messages';

import type { GraphNode, LangGraphRunnableConfig } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { aggregateSupportAnswerPrompt } from '../../prompts/aggregate-support-answer.prompt';

import {
  AggregateFinalAnswerSchema,
  type SupportAgentAnswerBlock,
} from '../../schemas/support-agent-answer.schema';

import { SupportAgentState } from '../support-agent.state';

const blockOrder: Record<SupportAgentAnswerBlock['worker'], number> = {
  order: 0,

  customer_help: 1,

  product_search: 2,
};

function uniqueMessages(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];

  const seen = new Set<string>();

  for (const value of values) {
    const message = value?.trim();

    if (!message || seen.has(message)) {
      continue;
    }

    seen.add(message);

    result.push(message);
  }

  return result;
}

export function createAggregateFinalAnswerNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getYandexLiteChatModel();

  return async (
    state,

    config: LangGraphRunnableConfig,
  ) => {
    const blocks = [...state.workerResults].sort(
      (left, right) => blockOrder[left.worker] - blockOrder[right.worker],
    );

    if (blocks.length < 2) {
      throw new Error(
        `AggregateFinalAnswerNode: ожидалось минимум 2 worker results, получено ${blocks.length}`,
      );
    }

    const workspaceQuestion =
      state.productWorkspace?.pendingClarification?.question ?? null;

    const groupQuestions = blocks.flatMap((block) =>
      block.worker === 'product_search'
        ? block.data.groups
            .filter((group) => group.status === 'clarification')
            .map((group) => group.message)
        : [],
    );

    const pendingQuestions = uniqueMessages([
      workspaceQuestion,

      ...groupQuestions,
    ]);

    const workerResultsForPrompt = blocks.map((block) => {
      if (block.worker === 'customer_help') {
        return {
          worker: block.worker,

          data: {
            message: block.data.message,
          },
        };
      }

      if (block.worker === 'order') {
        return {
          worker: block.worker,

          data: {
            message: block.data.message,
          },
        };
      }

      const nonClarificationMessages = uniqueMessages(
        block.data.groups
          .filter((group) => group.status !== 'clarification')
          .map((group) => group.message),
      );

      const requiresClarification =
        workspaceQuestion !== null ||
        block.data.groups.some((group) => group.status === 'clarification');

      const productMessage =
        block.data.consultation?.message ??
        (nonClarificationMessages.length > 0
          ? nonClarificationMessages.join('\n')
          : requiresClarification
          ? 'Для продолжения подбора требуется уточнение.'
          : block.data.message);

      return {
        worker: block.worker,

        data: {
          message: productMessage,

          groups: block.data.groups.map((group) => ({
            query: group.query,

            message:
              group.status === 'clarification'
                ? 'Для этой подборки требуется уточнение.'
                : group.message,

            productsCount: group.products.length,
          })),
        },
      };
    });

    await dispatchCustomEvent(
      'assistant_status',

      {
        status: 'GENERATING_ANSWER',
      },

      config,
    );

    const prompt = await aggregateSupportAnswerPrompt.invoke({
      query: state.query,

      workerResults: JSON.stringify(
        workerResultsForPrompt,

        null,

        2,
      ),
    });

    const stream = await model.stream(prompt);

    let message = '';

    for await (const chunk of stream) {
      const delta = chunk.text;

      if (!delta) {
        continue;
      }

      message += delta;

      await dispatchCustomEvent(
        'assistant_delta',

        {
          delta,
        },

        config,
      );
    }

    if (!message.trim()) {
      throw new Error(
        'AggregateFinalAnswerNode: модель не вернула финальный текст',
      );
    }

    const questionsToAppend = pendingQuestions.filter(
      (question) => !message.includes(question),
    );

    if (questionsToAppend.length > 0) {
      const delta = `\n\n${questionsToAppend.join('\n')}`;

      message += delta;

      await dispatchCustomEvent(
        'assistant_delta',

        {
          delta,
        },

        config,
      );
    }

    const answer = AggregateFinalAnswerSchema.parse({
      type: 'aggregate',

      message,

      blocks,
    });

    return {
      answer,

      messages: [new AIMessage(answer.message)],
    };
  };
}
