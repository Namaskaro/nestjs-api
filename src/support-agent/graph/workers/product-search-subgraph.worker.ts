import type { GraphNode } from '@langchain/langgraph';

import type { ProductSearchAgentGraph } from '../../product-agent/product.agent.graph';

import { ProductSearchAnswerBlockSchema } from '../../schemas/support-agent-answer.schema';

import { SupportAgentState } from '../support-agent.state';

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

    const workerResult = ProductSearchAnswerBlockSchema.parse({
      worker: 'product_search',

      data: productAgentResult.answer,
    });

    return {
      workerResults: [workerResult],
    };
  };
}
