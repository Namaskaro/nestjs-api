import {
  type ProductContext,
  type ProductNeedMemory,
} from '../../../../product-consultation/application/context/product-context.schema';

import { ProductAgentService } from '../product-agent.service';

import type { ProductAgentStateType } from '../product-agent.state';

import type { ConsultationAgent } from '../subagents/consultation-agent/consultation.agent';

// ===== START CHANGE: SEPARATE COMPARISON SYNTHESIS DEPENDENCY =====

import type { ComparisonSynthesis } from '../subagents/consultation-agent/comparison-synthesis';

// ===== END CHANGE: SEPARATE COMPARISON SYNTHESIS DEPENDENCY =====

export type ProductTurnContext = {
  state: ProductAgentStateType;

  context: ProductContext;

  productAgentService: ProductAgentService;

  consultant: ConsultationAgent;

  // ===== START CHANGE: COMPARE DOES NOT BELONG TO CONSULTATION AGENT =====

  comparisonSynthesis: ComparisonSynthesis;

  // ===== END CHANGE: COMPARE DOES NOT BELONG TO CONSULTATION AGENT =====
};

export function findProductNeed(
  context: ProductContext,
  needId: string,
): ProductNeedMemory {
  const need = context.needs.find((item) => item.needId === needId);

  if (!need) {
    throw new Error('ProductAgent: active need отсутствует в context');
  }

  return need;
}

export function emptyConsultationPatch() {
  return {
    goals: {
      add: [],
      update: [],
      remove: [],
    },

    criteria: {
      add: [],
      update: [],
      remove: [],
    },

    feedback: {
      upsert: [],
      remove: [],
    },
  };
}
