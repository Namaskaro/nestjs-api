import { readProductContext } from '../../../schemas/product-context.schema';

import type { ProductAgentStateUpdate } from '../product-agent.state';

import { prepareConsultationRuntime } from './consultation-runtime';

import { handleCompareTurn } from './compare.turn';

import { handleConsultationTurn } from './consultation.turn';

import { handleDetailsTurn } from './details.turn';

import { handleFeedbackTurn } from './feedback.turn';

import type { ProductTurnContext } from './product-turn.context';

import { handleSearchShowTurn } from './search-show.turn';

type HandleProductTurnInput = Omit<ProductTurnContext, 'context'>;

export async function handleProductTurn({
  state,
  productAgentService,
  consultant,

  // ===== START CHANGE: RECEIVE SEPARATE COMPARISON SYNTHESIS =====

  comparisonSynthesis,
}: // ===== END CHANGE: RECEIVE SEPARATE COMPARISON SYNTHESIS =====
HandleProductTurnInput): Promise<ProductAgentStateUpdate> {
  const context = readProductContext(state.productContext);

  const turn: ProductTurnContext = {
    state,

    context,

    productAgentService,

    consultant,

    // ===== START CHANGE: PASS SYNTHESIS THROUGH PRODUCT TURN CONTEXT =====

    comparisonSynthesis,

    // ===== END CHANGE: PASS SYNTHESIS THROUGH PRODUCT TURN CONTEXT =====
  };

  if (state.turn.action === 'SEARCH' || state.turn.action === 'SHOW') {
    return handleSearchShowTurn(turn);
  }

  if (state.turn.action === 'CLARIFY') {
    throw new Error(
      'ProductAgent: CLARIFY не должен доходить до consultProducts',
    );
  }

  const prepared = await prepareConsultationRuntime(turn);

  if (prepared.ok === false) {
    return prepared.update;
  }

  const { runtime } = prepared;

  switch (state.turn.action) {
    case 'DETAILS':
      return handleDetailsTurn(turn, runtime);

    case 'FEEDBACK':
      return handleFeedbackTurn(turn, runtime);

    case 'COMPARE':
      return handleCompareTurn(turn, runtime);

    case 'CONSULT':
      return handleConsultationTurn(turn, runtime);

    default:
      throw new Error(
        `ProductAgent: неподдерживаемое действие ${state.turn.action}`,
      );
  }
}
