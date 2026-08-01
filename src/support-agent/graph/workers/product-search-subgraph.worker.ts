// import type { GraphNode } from '@langchain/langgraph';
// import { SupportAgentState } from '../support-agent.state';
// import { ProductSearchAgentGraph } from '../../product-agent/product.agent.graph';

// export function createProductSearchSubgraphWorker(
//   productSearchAgentGraph: ProductSearchAgentGraph,
// ): GraphNode<typeof SupportAgentState> {
//   return async (state) => {
//     /**
//      * Преобразуем SupportAgentState
//      * во вход ProductAgentState.
//      *
//      * Если остальные поля ProductAgentState
//      * имеют default(), достаточно передать query.
//      */
//     const productAgentResult = await productSearchAgentGraph.invoke({
//       query: state.query,
//     });

//     /**
//      * Преобразуем результат ProductAgentState
//      * обратно в SupportAgentState.
//      */
//     return {
//       answer: {
//         message: productAgentResult.answer.message,

//         blocks: [
//           {
//             type: 'product_search',
//             data: productAgentResult.answer,
//           },
//         ],
//       },
//     };
//   };
// }

import type { GraphNode } from '@langchain/langgraph';

import { SupportAgentState } from '../support-agent.state';
import type { ProductSearchAgentGraph } from '../../product-agent/product.agent.graph';

export function createProductSearchSubgraphWorker(
  productSearchAgentGraph: ProductSearchAgentGraph,
): GraphNode<typeof SupportAgentState> {
  return async (state) => {
    const productAgentResult = await productSearchAgentGraph.invoke({
      query: state.query,
    });

    if (!productAgentResult.answer) {
      throw new Error(
        'ProductSearchSubgraphWorker: product-agent не вернул answer',
      );
    }

    return {
      productSearchResult: productAgentResult.answer,
    };
  };
}
