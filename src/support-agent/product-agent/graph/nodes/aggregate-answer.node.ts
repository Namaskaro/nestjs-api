import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentState } from '../../product-agent.state';

import {
  ProductAgentAnswerSchema,
  ProductAgentMessageSchema,
} from '../../schemas/agreagte-answer.schema';

import { finalProductAnswerPrompt } from '../../prompts/aggregate-answer.prompt';

export function createAggregateAnswerNode(
  aiService: AiService,
): GraphNode<typeof ProductAgentState> {
  const model = aiService.getChatModel('yandex');

  const structuredAggregator = model.withStructuredOutput(
    ProductAgentMessageSchema,
    {
      name: 'aggregate_product_search',
    },
  );

  const chain = finalProductAnswerPrompt.pipe(structuredAggregator);

  return async (state) => {
    const orderedSearchResults = [...state.searchResults].sort(
      (left, right) =>
        state.normalizedQueries.indexOf(left.searchQuery) -
        state.normalizedQueries.indexOf(right.searchQuery),
    );

    const generatedText = await chain.invoke({
      query: state.query,

      searchResults: JSON.stringify(orderedSearchResults, null, 2),
    });

    const messageByQuery = new Map(
      generatedText.groups.map((group) => [group.query, group.message]),
    );

    const answer = ProductAgentAnswerSchema.parse({
      message: generatedText.message,

      groups: orderedSearchResults.map((result) => ({
        query: result.searchQuery,

        message:
          messageByQuery.get(result.searchQuery) ??
          (result.products.length > 0
            ? 'Вот что удалось найти.'
            : 'Подходящие товары не найдены.'),

        products: result.products,
      })),
    });

    return {
      answer,
    };
  };
}
