import { readProductContext } from '../context/product-context.schema';

import {
  buildConsultationCompletionPresentation,
  completeConsultationSession,
} from '../session/consultation-session';

import type { ProductAgentStateUpdate } from '../agent/product-agent.state';

import type { ProductTurnContext } from '../../../support-agent/agents/product-agent/product-turn/product-turn.context';

function completionMessage(
  reason: NonNullable<ProductTurnContext['state']['turn']['completionReason']>,
): string {
  switch (reason) {
    case 'PRODUCT_SELECTED':
      return 'Отлично, выбор зафиксирован. Была ли консультация полезной?';

    case 'USER_STOPPED':
      return 'Хорошо, остановим подбор. Была ли консультация полезной?';

    case 'USER_DONE':
      return 'Хорошо, консультация завершена. Была ли она полезной?';
  }
}

export function handleCompleteConsultationTurn(
  turn: ProductTurnContext,
): ProductAgentStateUpdate {
  const { state, context } = turn;

  const reason = state.turn.completionReason;

  if (!reason) {
    throw new Error('ProductAgent: COMPLETE требует completionReason.');
  }

  const selectedProductIds =
    reason === 'PRODUCT_SELECTED'
      ? state.turn.products.map((reference) => reference.productId)
      : [];

  const session = completeConsultationSession(context, {
    reason,

    selectedProductIds,
  });

  const consultationCompletion =
    buildConsultationCompletionPresentation(session);

  context.pendingClarification = null;

  return {
    productContext: readProductContext(context),

    searchResults: [],

    consultation: null,

    consultationCompletion,

    message: completionMessage(reason),
  };
}
