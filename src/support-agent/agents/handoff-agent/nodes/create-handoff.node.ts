import type { GraphNode } from '@langchain/langgraph';

import { HandoffState } from '../handoff-agent.state';

import { HandoffSchema } from '../schemas/handoff.schema';

// START ИЗМЕНЕНИЙ — ДЕТЕРМИНИРОВАННАЯ СБОРКА HANDOFF
export const createHandoffNode: GraphNode<typeof HandoffState> = (state) => {
  if (!state.handoffRequest) {
    throw new Error('CreateHandoffNode: отсутствует handoffRequest');
  }

  if (!state.preparedContext) {
    throw new Error('CreateHandoffNode: отсутствует preparedContext');
  }

  return {
    handoff: HandoffSchema.parse({
      handoffMessage: 'Передаю ваш запрос оператору.',

      reason: state.handoffRequest.reason,

      trigger: state.handoffRequest.trigger,

      context: state.preparedContext,
    }),
  };
};
// END ИЗМЕНЕНИЙ — ДЕТЕРМИНИРОВАННАЯ СБОРКА HANDOFF
