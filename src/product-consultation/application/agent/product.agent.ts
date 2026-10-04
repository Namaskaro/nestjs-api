import { END, START, StateGraph } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { ProductAgentState } from '@/src/product-consultation/application/agent/product-agent.state';

import { createDecideProductNode } from './nodes/decide-product.node';

import { createExecuteProductWorkspaceNode } from './nodes/execute-product-workspace.node';

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
      createExecuteProductWorkspaceNode(aiService, productAgentService),
    )

    .addEdge(START, 'decideProduct')

    .addEdge('decideProduct', 'executeProductDecision')

    .addEdge('executeProductDecision', END)

    .compile();
}

export type ProductAgent = ReturnType<typeof createProductAgent>;
