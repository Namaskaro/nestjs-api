import { HandoffRequest } from '../schemas/handoff.schema';

type EntryHandoffRouteState = {
  handoffRequest: HandoffRequest | null;
};

type Route = 'operatorOfferNode' | 'prepareHandoffNode';

export function entryHandoffRoute(state: EntryHandoffRouteState): Route {
  const handoffRequest = state.handoffRequest;
  if (!handoffRequest) {
    throw new Error(
      'EntryHandoffRoute: отсутствует запрос на передачу диалога оператору',
    );
  }

  const { trigger } = handoffRequest;

  if (trigger === 'EXPLICIT_USER_REQUEST' || trigger === 'OPERATOR_BUTTON') {
    return 'prepareHandoffNode';
  }

  return 'operatorOfferNode';
}
