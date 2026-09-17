import { AIMessage } from '@langchain/core/messages';

import type { GraphNode } from '@langchain/langgraph';

import { SupportAgentState } from '../support-agent.state';

export const rejectNode: GraphNode<typeof SupportAgentState> = async (
  state,
) => {
  const message =
    'Я могу помочь с вопросами по магазину: подобрать товар, ' +
    'проверить заказ, рассказать о доставке и оплате, ' +
    'а также помочь с возвратом или претензией. ' +
    'Напишите, что вас интересует.';

  return {
    rejectCount: state.rejectCount + 1,

    answer: {
      message,
      blocks: [],
    },

    messages: [new AIMessage(message)],
  };
};
