import { MessagesValue, ReducedValue, StateSchema } from '@langchain/langgraph';
import z from 'zod';

import { ProductSearchResultSchema } from './schemas/product-search-results.schema';
import { ProductAgentAnswerSchema } from './schemas/agreagte-answer.schema';

export const ProductAgentState = new StateSchema({
  query: z.string(),
  messages: MessagesValue,
  normalizedQueries: z.array(z.string()).default(() => []),

  searchResults: new ReducedValue(
    z.array(ProductSearchResultSchema).default(() => []),
    {
      reducer: (currentResults, newResults) =>
        currentResults.concat(newResults),
    },
  ),
  answer: ProductAgentAnswerSchema.nullable().default(null),
});

export type ProductAgentStateType = typeof ProductAgentState.State;
export type ProductAgentStateUpdate = typeof ProductAgentState.Update;
