import { HandoffStateType } from '../handoff-agent.state';

// START ИЗМЕНЕНИЙ — ROUTE ПОСЛЕ ОТВЕТА ПОЛЬЗОВАТЕЛЯ
export type AfterOperatorOfferRoute = 'prepareHandoffNode' | 'end';

export function afterOperatorOfferRoute(
  state: HandoffStateType,
): AfterOperatorOfferRoute {
  if (!state.operatorOfferDecision) {
    throw new Error(
      'AfterOperatorOfferRoute: решение пользователя отсутствует',
    );
  }

  return state.operatorOfferDecision === 'accept'
    ? 'prepareHandoffNode'
    : 'end';
}
// END ИЗМЕНЕНИЙ — ROUTE ПОСЛЕ ОТВЕТА ПОЛЬЗОВАТЕЛЯ
