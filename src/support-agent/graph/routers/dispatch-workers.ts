import { OrchestratorWorker } from '../../schemas/orchestrator.schema';
import { SupportAgentStateType } from '../support-agent.state';

export function dispatchWorkers(
  state: SupportAgentStateType,
): OrchestratorWorker[] {
  const decision = state.orchestrator;

  if (!decision) {
    throw new Error('DispatchWorkers: orchestrator не записал решение в state');
  }

  return decision.workers;
}
