import { HumanMessage } from '@langchain/core/messages';
import { Send } from '@langchain/langgraph';
import type { SupportAgentStateType } from '../support-agent.state';

export function dispatchWorkers(state: SupportAgentStateType): Send[] {
  const decision = state.requestRouter;

  if (!decision) {
    throw new Error('DispatchWorkers: Request Router не записал решение');
  }

  return decision.workers.map((worker) => {
    const query =
      worker === 'productAgent' ? state.query : decision.workerQueries[worker];

    if (!query) {
      throw new Error('DispatchWorkers: отсутствует query для ' + worker);
    }

    return new Send(worker, {
      ...state,
      query,
      messages: [new HumanMessage(query)],
    });
  });
}
