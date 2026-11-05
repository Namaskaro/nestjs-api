import { AIMessage } from '@langchain/core/messages';

import type { GraphNode } from '@langchain/langgraph';

import { readProductContext } from '../../../../product-consultation/application/context/product-context.schema';

import { SupportAgentState } from '../../../graph/support-agent.state';

export const handoffResultNode: GraphNode<typeof SupportAgentState> = (
  state,
) => {
  const productContext = readProductContext(state.productContext);

  if (state.handoff) {
    /*
     * Handoff здесь только подготовлен.
     *
     * Фактическое создание обращения и
     * назначение оператора выполнит
     * ChatHandoffService.
     *
     * Поэтому не отмечаем консультацию
     * завершённой до успешной записи в БД.
     */
    const message = 'Запрос на передачу оператору подготовлен.';

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
