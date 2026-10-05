import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';

import { AIMessage } from '@langchain/core/messages';

import type { GraphNode, LangGraphRunnableConfig } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import {
  AggregateFinalAnswerSchema,
  type SupportAgentAnswerBlock,
} from '../../schemas/support-agent-answer.schema';

import { SupportAgentState } from '../support-agent.state';

const blockOrder: Record<SupportAgentAnswerBlock['worker'], number> = {
  product_search: 0,

  order: 1,

  customer_help: 2,
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

function stripMessages(
  value: string,

  removed: readonly string[],
): string {
  let result = value.trim();

  for (const message of removed) {
    result = result.split(message).join('');
  }

  return result
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
}

function productMessage(
  block: Extract<
    SupportAgentAnswerBlock,
    {
      worker: 'product_search';
    }
  >,

  workspaceQuestion: string | null,
): string {
  const groupQuestions = (block.data.resultGroups ?? block.data.groups)
    .filter((group) => group.status === 'clarification')
    .map((group) => group.message);

  const questions = uniqueMessages([workspaceQuestion, ...groupQuestions]);

  const base = stripMessages(
    block.data.message,

    questions,
  );

  const parts = uniqueMessages([base, ...questions]);

  return parts.join('\n\n');
}

function sectionForBlock(
  block: SupportAgentAnswerBlock,

  workspaceQuestion: string | null,
): string {
  if (block.worker === 'product_search') {
    const message = productMessage(
      block,

      workspaceQuestion,
    );

    return ['Товары:', message || 'Готово.'].join('\n');
  }

  if (block.worker === 'order') {
    return ['Заказ:', block.data.message.trim()].join('\n');
  }

  return ['Информация магазина:', block.data.message.trim()].join('\n');
}

export function createAggregateFinalAnswerNode(
  _aiService: AiService,
): GraphNode<typeof SupportAgentState> {
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

    const message = blocks
      .map((block) =>
        sectionForBlock(
          block,

          workspaceQuestion,
        ),
      )
      .join('\n\n');

    if (!message.trim()) {
      throw new Error(
        'AggregateFinalAnswerNode: не удалось собрать финальный текст',
      );
    }

    await dispatchCustomEvent(
      'assistant_status',

      {
        status: 'GENERATING_ANSWER',
      },

      config,
    );

    await dispatchCustomEvent(
      'assistant_delta',

      {
        delta: message,
      },

      config,
    );

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
