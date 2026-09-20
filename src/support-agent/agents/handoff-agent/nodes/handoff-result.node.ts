import { AIMessage } from '@langchain/core/messages';

import type { GraphNode } from '@langchain/langgraph';

import { markConsultationSessionHandedOff } from '../../product-agent/consultation-session';

import { readProductContext } from '../../../../product-consultation/application/context/product-context.schema';

import { SupportAgentState } from '../../../graph/support-agent.state';

export const handoffResultNode: GraphNode<typeof SupportAgentState> = (
  state,
) => {
  const productContext = readProductContext(state.productContext);

  if (state.handoff) {
    markConsultationSessionHandedOff(productContext);

    const message = state.handoff.handoffMessage;

    return {
      activeAgent: null,

      productContext,

      handoffRequest: null,

      answer: {
        message,

        blocks: [],
      },

      messages: [new AIMessage(message)],
    };
  }

  const hasActiveProductConsultation =
    productContext.consultationSession?.status === 'ACTIVE';

  const message = 'Хорошо. Если понадобится оператор, просто скажите.';

  return {
    activeAgent: hasActiveProductConsultation ? 'productAgent' : null,

    productContext,

    handoffRequest: null,

    answer: {
      message,

      blocks: [],
    },

    messages: [new AIMessage(message)],
  };
};
