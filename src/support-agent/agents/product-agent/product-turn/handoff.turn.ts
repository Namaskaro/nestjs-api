import { readProductContext } from '../../../schemas/product-context.schema';

import type { ProductAgentStateUpdate } from '../product-agent.state';

import type { ProductTurnContext } from './product-turn.context';

export function handleProductHandoffTurn(
  turn: ProductTurnContext,
): ProductAgentStateUpdate {
  const { state, context } = turn;

  if (!state.turn.handoffRequest) {
    throw new Error('ProductAgent: HANDOFF требует handoffRequest.');
  }

  context.pendingClarification = null;

  return {
    productContext: readProductContext(context),

    searchResults: [],

    consultation: null,

    consultationCompletion: null,

    message: 'Передаю запрос на обработку handoff.',
  };
}
