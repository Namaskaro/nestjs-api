import { ReducedValue, StateSchema } from '@langchain/langgraph';
import z from 'zod';
import { ProductSearchResultSchema } from '../../schemas/product-search-results.schema';

export const ProductSearchWorkerState = new StateSchema({
  /**
   * Один поисковый запрос, переданный через Send.
   */
  searchQuery: z.string(),

  /**
   * Worker возвращает результат в это поле.
   *
   * Название совпадает с полем
   * ProductAgentState.searchResults.
   */
  searchResults: new ReducedValue(
    z.array(ProductSearchResultSchema).default(() => []),
    {
      reducer: (currentResults, newResults) =>
        currentResults.concat(newResults),
    },
  ),
});
