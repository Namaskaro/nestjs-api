import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '../../../../ai/ai.service';

import { ProductAgentService } from '../product-agent.service';

import { ProductAgentState } from '../product-agent.state';

import { handleProductTurn } from '../product-turn/product-turn';

import { createConsultationAgent } from '../subagents/consultation-agent/consultation.agent';

// ===== START CHANGE: CREATE COMPARISON SYNTHESIS SEPARATELY =====

import { createComparisonSynthesis } from '../subagents/consultation-agent/comparison-synthesis';

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
