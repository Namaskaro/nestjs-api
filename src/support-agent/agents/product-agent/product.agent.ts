import { END, START, StateGraph } from '@langchain/langgraph';
import { AiService } from '../../../ai/ai.service';
import { createConsultProductsNode } from './nodes/consult-products.node';
import { createPlanProductNode } from './nodes/plan-product.node';
import { createSearchProductsNode } from './nodes/search-products.node';
import { ProductAgentService } from './product-agent.service';
import {
  ProductAgentState,
  type ProductAgentStateType,
} from './product-agent.state';

function routeAfterPlan(state: ProductAgentStateType) {
  return state.activeNeedIds.length > 0 ? 'searchProducts' : END;
}

export function createProductAgent(
  aiService: AiService,
  productAgentService: ProductAgentService,
) {
  return new StateGraph(ProductAgentState)
    .addNode(
      'planProduct',
      createPlanProductNode(aiService, productAgentService),
    )
    .addNode('searchProducts', createSearchProductsNode(productAgentService))
    .addNode(
      'consultProducts',
      createConsultProductsNode(aiService, productAgentService),
    )
    .addEdge(START, 'planProduct')
    .addConditionalEdges('planProduct', routeAfterPlan)
    .addEdge('searchProducts', 'consultProducts')
    .addEdge('consultProducts', END)
    .compile();
}

export type ProductAgent = ReturnType<typeof createProductAgent>;
