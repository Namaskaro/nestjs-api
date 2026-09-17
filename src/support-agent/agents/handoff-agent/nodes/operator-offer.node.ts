import { interrupt, type GraphNode } from '@langchain/langgraph';

import { HandoffState } from '../handoff-agent.state';

import {
  OperatorOfferInterruptSchema,
  OperatorOfferResumeSchema,
} from '../schemas/operator-offer.schema';

// START ИЗМЕНЕНИЙ — OPERATOR OFFER NODE
export function createOperatorOfferNode(): GraphNode<typeof HandoffState> {
  return () => {
    const interruptPayload = OperatorOfferInterruptSchema.parse({
      kind: 'operator_offer',

      question:
        'Для решения этого вопроса нужен оператор. Передать ваш запрос?',

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
// END ИЗМЕНЕНИЙ — OPERATOR OFFER NODE
