import { AiService } from '@/src/ai/ai.service';
import { createNormalizeQueryNode } from './graph/nodes/normalize-query.node';
import { ProductAgentState } from './product-agent.state';
import { END, START, StateGraph } from '@langchain/langgraph';
import { createSearchProductWorker } from './graph/nodes/search-product-worker.node';
import { ProductAgentService } from './product-agent.service';
import { createAggregateAnswerNode } from './graph/nodes/aggregate-answer.node';
import { dispatchProductSearchWorkers } from './routers/dispatch-product-search-workers';

export function createProductSearchAgentGraph(
  aiService: AiService,
  productService: ProductAgentService,
) {
  const normalizeProductQueryNode = createNormalizeQueryNode(aiService);
  const searchProductNode = createSearchProductWorker(productService);
  const aggregateAnswerNode = createAggregateAnswerNode(aiService);

  return new StateGraph(ProductAgentState)
    .addNode('normalizeQuery', normalizeProductQueryNode)
    .addNode('searchProduct', searchProductNode)
    .addNode('aggregateAnswer', aggregateAnswerNode)
    .addEdge(START, 'normalizeQuery')

    .addConditionalEdges('normalizeQuery', dispatchProductSearchWorkers, [
      'searchProduct',
    ])
    .addEdge('searchProduct', 'aggregateAnswer')
    .addEdge('aggregateAnswer', END)

    .compile();
}

export type ProductSearchAgentGraph = ReturnType<
  typeof createProductSearchAgentGraph
>;
