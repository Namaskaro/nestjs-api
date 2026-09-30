import { END, START, StateGraph } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { ProductAgentState } from '@/src/product-consultation/application/agent/product-agent.state';

import { createDecideProductNode } from './nodes/decide-product.node';

import { createExecuteProductDecisionNode } from './nodes/execute-product-decision.node';

export function createProductAgent(
  aiService: AiService,
  productAgentService: ProductAgentService,
) {
  return new StateGraph(ProductAgentState)
    .addNode(
      'decideProduct',
      createDecideProductNode(aiService, productAgentService),
    )

    .addNode(
      'executeProductDecision',
      createExecuteProductDecisionNode(aiService, productAgentService),
    )

    .addEdge(START, 'decideProduct')

    .addEdge('decideProduct', 'executeProductDecision')

    .addEdge('executeProductDecision', END)

    .compile();
}

export type ProductAgent = ReturnType<typeof createProductAgent>;
