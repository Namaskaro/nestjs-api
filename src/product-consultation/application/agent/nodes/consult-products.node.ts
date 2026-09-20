import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { ProductAgentState } from '@/src/product-consultation/application/agent/product-agent.state';

import { handleProductTurn } from '@/src/product-consultation/application/turns/product-turn';

import { createConsultationAgent } from '@/src/product-consultation/application/consultation-agent/consultation.agent';

// ===== START CHANGE: CREATE COMPARISON SYNTHESIS SEPARATELY =====

import { createComparisonSynthesis } from '@/src/product-consultation/application/consultation-agent/comparison-synthesis';

// ===== END CHANGE: CREATE COMPARISON SYNTHESIS SEPARATELY =====

export function createConsultProductsNode(
  aiService: AiService,
  productAgentService: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  const consultant = createConsultationAgent(aiService);

  // ===== START CHANGE: SEPARATE COMPONENT FOR COMPARE =====

  const comparisonSynthesis = createComparisonSynthesis(aiService);

  // ===== END CHANGE: SEPARATE COMPONENT FOR COMPARE =====

  return async (state) =>
    handleProductTurn({
      state,

      productAgentService,

      consultant,

      // ===== START CHANGE: INJECT INTO TURN =====

      comparisonSynthesis,

      // ===== END CHANGE: INJECT INTO TURN =====
    });
}
