import type { OrchestratorWorker } from '../../schemas/orchestrator.schema';

import type { SupportAgentStateType } from '../support-agent.state';

export function dispatchWorkers(
  state: SupportAgentStateType,
): OrchestratorWorker[] {
  const decision = state.orchestrator;

  if (!decision) {
    throw new Error('DispatchWorkers: orchestrator не записал решение в state');
  }

  if (decision.workers.length === 0) {
    throw new Error(
      'DispatchWorkers: orchestrator не выбрал ни одного воркера',
    );
  }

  /**
   * Один элемент:
   *
   * ['faqSearchWorker']
   *
   * Несколько элементов:
   *
   * ['faqSearchWorker', 'productSearch']
   *
   * Во втором случае LangGraph
   * запустит обе ветки параллельно.
   */
  return decision.workers;
}
