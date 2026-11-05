import { interrupt, type GraphNode } from '@langchain/langgraph';

import { HandoffState } from '../handoff-agent.state';

import {
  OperatorOfferInterruptSchema,
  OperatorOfferResumeSchema,
} from '../schemas/operator-offer.schema';

import type { HandoffRequest } from '../schemas/handoff.schema';

function getOfferQuestion(request: HandoffRequest): string {
  switch (request.trigger) {
    case 'NEGATIVE_FEEDBACK':
      return (
        'Похоже, мой ответ не помог решить вопрос. ' +
        'Хотите, я подключу оператора?'
      );

    case 'AGENT_ERROR':
      return (
        'Мне не удалось завершить обработку запроса. ' +
        'Хотите передать вопрос оператору?'
      );

    case 'UNSUPPORTED_INTENT':
      return (
        'Для этого запроса может потребоваться помощь ' +
        'сотрудника магазина. Передать ему ваш вопрос?'
      );

    default:
      return (
        'Я могу предложить помощь оператора магазина. ' +
        'Хотите, чтобы я передал ему ваш вопрос?'
      );
  }
}

export function createOperatorOfferNode(): GraphNode<typeof HandoffState> {
  return (state) => {
    if (!state.handoffRequest) {
      throw new Error(
        'OperatorOfferNode: отсутствует запрос на передачу оператору',
      );
    }

    const interruptPayload = OperatorOfferInterruptSchema.parse({
      kind: 'operator_offer',

      question: getOfferQuestion(state.handoffRequest),

      options: [
        {
          id: 'accept',
          label: 'Да, позовите оператора',
        },
        {
          id: 'decline',
          label: 'Нет, спасибо',
        },
      ],
    });

    const rawResumeValue = interrupt(interruptPayload);

    const resumeValue = OperatorOfferResumeSchema.parse(rawResumeValue);

    return {
      operatorOfferDecision: resumeValue.decision,
    };
  };
}
