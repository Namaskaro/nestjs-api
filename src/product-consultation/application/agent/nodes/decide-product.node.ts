import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { ProductAgentState } from '@/src/product-consultation/application/agent/product-agent.state';

import { createConsultationAgent } from '@/src/product-consultation/application/consultation-agent/consultation.agent';

import { buildProductConsultationContext } from '@/src/product-consultation/application/context/product-consultation-context';

export function createDecideProductNode(
  aiService: AiService,
  productAgentService: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  const consultant = createConsultationAgent(aiService);

  return async (state) => {
    const context = buildProductConsultationContext({
      record: state.consultationRecord,

      currentMessage: state.query,

      recentMessages: state.recentMessages,

      searchCapabilities: productAgentService.capabilities(),
    });

    const decision = await consultant.decide({
      context: context.context,

      observation: {
        kind: 'initial',
      },
    });

    return {
      decision,
    };
  };
}
