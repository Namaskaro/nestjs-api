import type {
  ProductTaskExecutionInput,
  ProductTaskExecutionResult,
} from '../agent/nodes/execute-product-decision.node';
import type { ProductWorkspace } from './product-workspace';
import {
  type PreparedProductLane,
  prepareProductTaskAction,
  productActionRequestId,
  productTaskFocus,
} from './product-workspace-plan';
import type { ProductSearchPort } from '../search/product-search.port';
import type { ProductConsultantDecision } from '../consultant/product-consultant-decision.schema';

export type ProductLaneOutcome = Awaited<ReturnType<typeof executeProductLane>>;

/** Owns exactly one task. Sibling lanes never share this mutable local copy. */
export async function executeProductLane(input: {
  lane: PreparedProductLane;
  focus: ProductWorkspace['focus'][number] | undefined;
  conversationId: string;
  requestId: string;
  search: Pick<ProductSearchPort, 'validate'>;
  executeAction: (
    input: ProductTaskExecutionInput,
  ) => Promise<ProductTaskExecutionResult>;
}) {
  const task = structuredClone(input.lane.task);
  let focus = input.focus;
  let closed = input.lane.kind === 'remove';
  let handoffRequested = false;
  const actions: Array<{
    decision: ProductConsultantDecision;
    result: ProductTaskExecutionResult;
  }> = [];
  for (const [ordinal, action] of input.lane.actions.entries()) {
    let decision = action.decision;
    let result: ProductTaskExecutionResult;
    try {
      decision = prepareProductTaskAction(
        task,
        action,
        focus,
        input.search,
      ).decision;
      result = await input.executeAction({
        query: input.lane.query,
        conversationId: `${input.conversationId}:${task.taskId}`,
        requestId: productActionRequestId(
          input.requestId,
          task.taskId,
          ordinal,
        ),
        consultationRecord: task.record,
        decision,
        recentMessages: [],
      });
    } catch {
      result = {
        consultationRecord: task.record,
        consultation: null,
        consultationCompletion: null,
        failed: true,
        message:
          'Не удалось выполнить следующее действие для этой подборки. Уточните товар или повторите запрос.',
      };
    }
    // Always keep the accepted state, including a failed capability after a write.
    task.record = result.consultationRecord;
    if (
      task.lastComparison?.resultId !== task.record.results.active?.resultId
    ) {
      delete task.lastComparison;
    }
    actions.push({ decision, result });
    if (result.failed) break;
    task.question =
      result.recovery?.question ??
      (decision.proposal.action === 'CLARIFY' ? result.message : null);
    focus = productTaskFocus(task, decision);
    if (
      decision.proposal.action === 'COMPARE' &&
      result.consultation?.comparisonPresentation
    ) {
      task.lastComparison = {
        resultId: focus.resultId!,
        positions: [...focus.positions],
      };
    }
    closed = decision.proposal.action === 'COMPLETE';
    handoffRequested = decision.proposal.action === 'HANDOFF';
    // Recovery awaits the user's choice; it is a successful pause, not a failure.
    if (result.recovery) break;
  }
  // A failed search may clear active results; never retain a stale focus reference.
  if (focus?.resultId !== (task.record.results.active?.resultId ?? null)) {
    focus = {
      taskId: task.taskId,
      resultId: task.record.results.active?.resultId ?? null,
      positions:
        task.record.results.active?.products.map((_, index) => index + 1) ?? [],
    };
  }
  return { task, actions, focus, closed, handoffRequested };
}
