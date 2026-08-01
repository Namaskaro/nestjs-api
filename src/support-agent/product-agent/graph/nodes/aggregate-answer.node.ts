import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentState } from '../../product-agent.state';

import { ProductAgentAnswerSchema } from '../../schemas/agreagte-answer.schema';

import { finalProductAnswerPrompt } from '../../prompts/aggregate-answer.prompt';

export function createAggregateAnswerNode(
  aiService: AiService,
): GraphNode<typeof ProductAgentState> {
  const model = aiService.getChatModel('yandex');

  const structuredAggregator = model.withStructuredOutput(
    ProductAgentAnswerSchema,
    {
      name: 'aggregate_product_search',
    },
  );

  const chain = finalProductAnswerPrompt.pipe(structuredAggregator);

  return async (state) => {
    const finalAnswer = await chain.invoke({
      query: state.query,

      searchResults: JSON.stringify(state.searchResults, null, 2),
    });

    return {
      answer: finalAnswer,
    };
  };
}
