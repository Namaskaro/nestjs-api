import type { GraphNode } from '@langchain/langgraph';
import { AiService } from '@/src/ai/ai.service';
import { ProductAgentService } from '../product-agent.service';
import { ProductAgentState } from '../product-agent.state';
import { ProductWorkspaceSchema } from '../../workspace/product-workspace';
import {
  prepareProductWorkspacePlan,
  ProductWorkspaceClarification,
} from '../../workspace/product-workspace-plan';
import { appendProcessedRequestId } from '../../runtime/consultation-application-record';
import { createExecuteProductDecisionNode } from './execute-product-decision.node';
import type { ProductAgentAnswer } from '../agreagte-answer.schema';

export function createExecuteProductWorkspaceNode(
  aiService: AiService,
  service: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  const executeTask = createExecuteProductDecisionNode(aiService, service);
  return async (state) => {
    const workspace = ProductWorkspaceSchema.parse(
      structuredClone(state.workspace),
    );
    const empty = {
      groups: [],
      consultation: null,
      consultationCompletion: null,
      handoffRequested: false,
    };
    if (workspace.processedRequestIds.includes(state.requestId)) {
      return { ...empty, workspace, message: 'Этот запрос уже обработан.' };
    }
    if (!state.plan) throw new Error('Product workspace plan is missing.');
    const acknowledge = () => {
      workspace.processedRequestIds = appendProcessedRequestId(
        workspace.processedRequestIds,
        state.requestId,
      );
      return ProductWorkspaceSchema.parse(workspace);
    };
    if (state.plan.clarification) {
      workspace.pendingClarification = {
        query: state.query.slice(0, 4000),
        question: state.plan.clarification,
      };
      return {
        ...empty,
        workspace: acknowledge(),
        message: state.plan.clarification,
      };
    }
    let operations: ReturnType<typeof prepareProductWorkspacePlan>;
    try {
      operations = prepareProductWorkspacePlan({
        workspace,
        plan: state.plan,
        query: state.query,
        conversationId: state.conversationId,
        requestId: state.requestId,
        search: service,
      });
    } catch (error) {
      // No task has been written yet. Invalid model semantics become a clarification.
      const message =
        error instanceof ProductWorkspaceClarification
          ? error.message
          : 'Уточните, какой подбор и какие условия нужно использовать.';
      workspace.pendingClarification = {
        query: state.query.slice(0, 4000),
        question: message,
      };
      return { ...empty, workspace: acknowledge(), message };
    }
    workspace.pendingClarification = null;
    const outcomes = await Promise.all(
      operations.map(async (operation) => {
        if (operation.kind === 'remove') return { operation, result: null };
        const result = await executeTask({
          query: operation.query,
          conversationId: `${state.conversationId}:${operation.task.taskId}`,
          requestId: state.requestId,
          consultationRecord: operation.task.record,
          decision: operation.decision!,
          // The record carries task memory; cross-task conversation history is not evidence.
          recentMessages: [],
        });
        return { operation, result };
      }),
    );
    const groups: ProductAgentAnswer['groups'] = [];
    const focus: typeof workspace.focus = [];
    let handoffRequested = false;
    for (const { operation, result } of outcomes) {
      const task = { ...operation.task };
      const action = operation.decision?.proposal.action;
      const closed = operation.kind === 'remove' || action === 'COMPLETE';
      if (closed) {
        workspace.tasks = workspace.tasks.filter(
          (current) => current.taskId !== task.taskId,
        );
      } else if (result) {
        task.record = result.consultationRecord;
        task.question = action === 'CLARIFY' ? result.message : null;
        const index = workspace.tasks.findIndex(
          (current) => current.taskId === task.taskId,
        );
        if (index < 0) workspace.tasks.push(task);
        else workspace.tasks[index] = task;
        const snapshot = task.record.results.active;
        const selection =
          operation.decision?.proposal.selection ??
          operation.decision?.proposal.feedback?.selection;
        const positions =
          selection?.kind === 'positions'
            ? selection.positions
            : snapshot?.products.map((_, index) => index + 1) ?? [];
        focus.push({
          taskId: task.taskId,
          resultId: snapshot?.resultId ?? null,
          positions: snapshot ? positions : [],
        });
      }
      if (action === 'HANDOFF') handoffRequested = true;
      const snapshot = task.record.results.active;
      const showProducts =
        action === 'SEARCH' || action === 'REFINE' || action === 'SHOW_RESULTS';
      groups.push({
        taskId: task.taskId,
        query: task.record.state?.search?.semanticIntent ?? task.query,
        status: result?.failed
          ? 'failed'
          : closed
          ? 'closed'
          : action === 'CLARIFY'
          ? 'clarification'
          : showProducts && !snapshot
          ? 'failed'
          : showProducts && snapshot.products.length === 0
          ? 'empty'
          : 'ready',
        message: result?.message ?? 'Убрал указанную подборку.',
        products:
          showProducts && snapshot
            ? snapshot.products.map((product) => ({
                id: product.productId,
                title: product.title,
                price: product.price,
                image: product.image ?? '',
              }))
            : [],
        consultation: result?.consultation ?? null,
      });
    }
    // Removing one task must not discard reference context of surviving tasks.
    workspace.focus = focus.length
      ? focus
      : workspace.focus.filter((reference) =>
          workspace.tasks.some((task) => task.taskId === reference.taskId),
        );
    const single = outcomes.length === 1 ? outcomes[0].result : null;
    return {
      workspace: acknowledge(),
      groups,
      handoffRequested,
      consultation: single?.consultation ?? null,
      consultationCompletion: single?.consultationCompletion ?? null,
      message:
        groups.length === 1
          ? groups[0].message
          : groups
              .map((group) => `«${group.query}»: ${group.message}`)
              .join('\n\n'),
    };
  };
}
