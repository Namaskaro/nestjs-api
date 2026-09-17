import type { GraphNode } from '@langchain/langgraph';
import { SupportAgentState } from '../../../graph/support-agent.state';

// START ИЗМЕНЕНИЙ — HANDOFF RESULT ДЛЯ ОСНОВНОГО SUPPORT FLOW
export const handoffResultNode: GraphNode<typeof SupportAgentState> = (
  state,
) => {
  if (state.handoff) {
    return {
      activeAgent: null,
      answer: {
        message: state.handoff.handoffMessage,

        blocks: [],
      },
    };
  }

  return {
    handoffRequest: null,

    answer: {
      message: 'Хорошо. Если понадобится оператор, просто скажите.',

      blocks: [],
    },
  };
};
// END ИЗМЕНЕНИЙ — HANDOFF RESULT ДЛЯ ОСНОВНОГО SUPPORT FLOW
