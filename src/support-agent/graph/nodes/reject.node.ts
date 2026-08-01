import { AIMessage } from '@langchain/core/messages';

import type { GraphNode } from '@langchain/langgraph';

import { SupportAgentState } from '../support-agent.state';

export const rejectNode: GraphNode<typeof SupportAgentState> = async () => {
  const message =
    'Я могу помочь с поиском товаров, ' +
    'заказами, доставкой, оплатой, ' +
    'возвратами и правилами магазина.';

  return {
    answer: {
      message,
      blocks: [],
    },

    messages: [new AIMessage(message)],
  };
};
