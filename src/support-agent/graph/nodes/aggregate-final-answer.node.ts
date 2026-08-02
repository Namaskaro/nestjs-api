import { AIMessage } from '@langchain/core/messages';

import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { aggregateSupportAnswerPrompt } from '../../prompts/aggregate-support-answer.prompt';

import {
  SupportAgentAnswerSchema,
  SupportAgentMessageSchema,
  type SupportAgentAnswerBlock,
} from '../../schemas/support-agent-answer.schema';

import { SupportAgentState } from '../support-agent.state';

const blockOrder: Record<SupportAgentAnswerBlock['worker'], number> = {
  faq_worker: 0,
  product_search: 1,
};

export function createAggregateFinalAnswerNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getChatModel('yandex');

  const structuredAggregator = model.withStructuredOutput(
    SupportAgentMessageSchema,
    {
      name: 'aggregate_support_answer',
    },
  );

  const chain = aggregateSupportAnswerPrompt.pipe(structuredAggregator);

  return async (state) => {
    const blocks = [...state.workerResults].sort(
      (left, right) => blockOrder[left.worker] - blockOrder[right.worker],
    );

    const workerResultsForPrompt = blocks.map((block) => {
      if (block.worker === 'faq_worker') {
        return {
          worker: block.worker,

          data: block.data.map((result) => ({
            question: result.question,
            answer: result.answer,
          })),
        };
      }

      return {
        worker: block.worker,

        data: {
          message: block.data.message,

          groups: block.data.groups.map((group) => ({
            query: group.query,
            message: group.message,
            productsCount: group.products.length,
          })),
        },
      };
    });

    const aggregatedResult = await chain.invoke({
      query: state.query,

      workerResults: JSON.stringify(workerResultsForPrompt, null, 2),
    });

    /**
     * message создаёт LLM.
     * blocks берутся непосредственно из воркеров.
     */
    const answer = SupportAgentAnswerSchema.parse({
      message: aggregatedResult.message,

      blocks,
    });

    return {
      answer,

      messages: [new AIMessage(answer.message)],
    };
  };
}
