import { SupportAgentStateType } from '../support-agent.state';
import { dispatchWorkers } from './dispatch-workers';

export function afterRequestRoute(state: SupportAgentStateType) {
  const decision = state.requestRouter;

  if (!decision) {
    throw new Error('AfterRequestRoute: отсутствует результат Request Router');
  }

  if (decision.route === 'execute') {
    return dispatchWorkers(state);
  }

  if (decision.route === 'unsupported') {
    return state.rejectCount > 0 ? 'clarificationTopic' : 'reject';
  }

  if (decision.route === 'handoff') {
    return 'handoffAgent';
  }

  if (decision.route === 'clarification') {
    return decision.clarificationTopic
      ? 'clarificationQuestion'
      : 'clarificationTopic';
  }
}
