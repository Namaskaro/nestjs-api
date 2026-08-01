// import { GraphNode } from '@langchain/langgraph';
// import { ProductAgentService } from '../../product-agent.service';
// import { ProductSearchWorkerState } from '../state/search-product-worker.state';
// import { ProductAgentState } from '../../product-agent.state';

// export function createSearchProductWorker(
//   productAgentService: ProductAgentService,
// ): GraphNode<typeof ProductAgentState> {
//   return async (state) => {
//     /**
//      * Этот метод будет выполнять реальный pipeline:
//      *
//      * 1. semantic search;
//      * 2. lexical/full-text search;
//      * 3. объединение результатов;
//      * 4. rerank;
//      * 5. возврат top-N.
//      *
//      * Каждый параллельный запуск вызывает его
//      * со своим state.searchQuery.
//      */
//     const products = await productAgentService.hybridProductSearch(state.query);

//     return {
//       searchResults: [
//         {
//           searchQuery: state.query,
//           products,
//         },
//       ],
//     };
//   };
// }

import type { GraphNode } from '@langchain/langgraph';

import { ProductAgentService } from '../../product-agent.service';

import { ProductSearchWorkerState } from '../state/search-product-worker.state';

export function createSearchProductWorker(
  productAgentService: ProductAgentService,
): GraphNode<typeof ProductSearchWorkerState> {
  return async (state) => {
    /**
     * state.searchQuery — один элемент
     * массива normalizedQueries,
     * переданный через Send.
     */
    const products = await productAgentService.hybridProductSearch(
      state.searchQuery,
    );

    return {
      /**
       * Каждый параллельный worker
       * возвращает массив из одного результата.
       *
       * ReducedValue в ProductAgentState
       * объединит результаты всех workers.
       */
      searchResults: [
        {
          searchQuery: state.searchQuery,

          products,
        },
      ],
    };
  };
}
