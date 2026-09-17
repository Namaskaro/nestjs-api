import type { ProductAgentStateUpdate } from '../product-agent.state';
import {
  finishDeterministicTurn,
  type ConsultationRuntime,
} from './consultation-runtime';
import {
  emptyConsultationPatch,
  type ProductTurnContext,
} from './product-turn.context';

export function handleFeedbackTurn(
  turn: ProductTurnContext,
  runtime: ConsultationRuntime,
): ProductAgentStateUpdate {
  const { state } = turn;

  const { core } = runtime;

  const reference = state.turn.products[0];

  core.updateMemory({
    needId: reference.needId,

    expectedRevision: 0,

    patch: {
      ...emptyConsultationPatch(),

      feedback: {
        remove: [],

        upsert: [
          {
            productId: reference.productId,

            reaction: state.turn.reaction,

            reason: state.query.slice(0, 500),

            attributeId: null,

            sourceText: state.query.slice(0, 500),
          },
        ],
      },
    },
  });

  return finishDeterministicTurn(
    turn,
    runtime,
    'Учёл ваш отзыв об этом товаре.',
  );
}
