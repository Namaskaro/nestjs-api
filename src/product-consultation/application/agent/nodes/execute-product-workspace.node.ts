import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentService } from '../product-agent.service';

import { ProductAgentState } from '../product-agent.state';

import {
  ProductWorkspaceSchema,
  replaceProductWorkspaceContext,
} from '../../workspace/product-workspace';

import {
  prepareProductWorkspacePlan,
  ProductWorkspaceClarification,
  resolveProductWorkspaceLifecycle,
} from '../../workspace/product-workspace-plan';

import { appendProcessedRequestId } from '../../runtime/consultation-application-record';

import { createExecuteProductDecisionNode } from './execute-product-decision.node';

import type { ProductAgentAnswer } from '../agreagte-answer.schema';

function uniqueMessages(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];

  const seen = new Set<string>();

  for (const value of values) {
    const message = value?.trim();

    if (!message || seen.has(message)) {
      continue;
    }

    seen.add(message);

    result.push(message);
  }

  return result;
}

function userFacingClarification(message: string): string {
  const normalized = message.trim();

  if (
    [
      'Какую подборку вы имеете в виду? Укажите товар или название подбора.',
      'Уточните, какую именно подборку вы имеете в виду.',
      'Уточните, о какой подборке идёт речь.',
      'Уточните подборку.',
    ].includes(normalized)
  ) {
    return 'Какую подборку вы имеете в виду?';
  }

  return normalized;
}

export function productWorkspaceMessage(
  groups: ProductAgentAnswer['groups'],
): string {
  if (groups.length === 0) {
    return 'Готово.';
  }

  if (groups.length === 1) {
    const group = groups[0];

    if (group.status === 'ready' && group.products.length > 0) {
      return 'Нашёл подходящие варианты.';
    }

    return group.message || 'Готово.';
  }

  const ready = groups.filter(
    (group) => group.status === 'ready' && group.products.length > 0,
  );

  const clarification = groups.filter(
    (group) => group.status === 'clarification',
  );

  const empty = groups.filter((group) => group.status === 'empty');

  const failed = groups.filter((group) => group.status === 'failed');

  if (clarification.length > 0) {
    const questions = uniqueMessages(
      clarification.map((group) => userFacingClarification(group.message)),
    );

    return uniqueMessages([
      ready.length > 0 ? 'Часть вариантов нашёл.' : null,

      ...questions,
    ]).join('\n\n');
  }

  if (failed.length > 0) {
    return ready.length > 0
      ? 'Часть вариантов нашёл. Часть поиска выполнить не удалось.'
      : 'Не удалось завершить поиск товаров.';
  }

  if (empty.length > 0) {
    return ready.length > 0
      ? 'Часть вариантов нашёл. По другой части запроса подходящих товаров нет.'
      : 'Подходящих товаров не нашёл.';
  }

  if (groups.every((group) => group.status === 'closed')) {
    return 'Готово.';
  }

  if (ready.length > 0) {
    return 'Нашёл подходящие варианты.';
  }

  return 'Готово.';
}

export function productWorkspaceGroupMessage(input: {
  status: NonNullable<ProductAgentAnswer['groups'][number]['status']>;

  showProducts: boolean;

  productsCount: number;

  message: string;
}): string {
  if (
    input.status === 'ready' &&
    input.showProducts &&
    input.productsCount > 0
  ) {
    return '';
  }

  return input.message;
}

export function createExecuteProductWorkspaceNode(
  aiService: AiService,

  service: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  const executeTask = createExecuteProductDecisionNode(
    aiService,

    service,
  );

  return async (state) => {
    let workspace = ProductWorkspaceSchema.parse(
      structuredClone(state.workspace),
    );

    const empty = {
      groups: [],

      consultation: null,

      consultationCompletion: null,

      handoffRequested: false,
    };

    if (workspace.processedRequestIds.includes(state.requestId)) {
      return {
        ...empty,

        workspace,

        message: 'Этот запрос уже обработан.',
      };
    }

    if (!state.plan) {
      throw new Error('Product workspace plan is missing.');
    }

    const acknowledge = () => {
      workspace.processedRequestIds = appendProcessedRequestId(
        workspace.processedRequestIds,

        state.requestId,
      );

      return ProductWorkspaceSchema.parse(workspace);
    };

    if (state.plan.clarification) {
      const question = userFacingClarification(state.plan.clarification);

      workspace.pendingClarification = {
        query: state.query.slice(0, 4000),

        question,
      };

      return {
        ...empty,

        workspace: acknowledge(),

        message: question,
      };
    }

    let operations: ReturnType<typeof prepareProductWorkspacePlan>;

    try {
      operations = prepareProductWorkspacePlan({
        workspace,

        plan: state.plan,

        query: state.query,

        sourceQuery: state.sourceQuery ?? state.query,

        conversationId: state.conversationId,

        requestId: state.requestId,

        search: service,
      });
    } catch (error) {
      const message = userFacingClarification(
        error instanceof ProductWorkspaceClarification
          ? error.message
          : 'Уточните, какой товар и какие условия нужно использовать.',
      );

      workspace.pendingClarification = {
        query: state.query.slice(0, 4000),

        question: message,
      };

      return {
        ...empty,

        workspace: acknowledge(),

        message,
      };
    }

    const lifecycle = resolveProductWorkspaceLifecycle({
      plan: state.plan,

      sourceQuery: state.sourceQuery ?? state.query,
    });

    if (lifecycle === 'replace') {
      workspace = replaceProductWorkspaceContext(workspace);
    }

    workspace.pendingClarification = null;

    const outcomes = await Promise.all(
      operations.map(async (operation) => {
        if (operation.kind === 'remove') {
          return {
            operation,

            result: null,
          };
        }

        const result = await executeTask({
          query: operation.query,

          conversationId: `${state.conversationId}:${operation.task.taskId}`,

          requestId: state.requestId,

          consultationRecord: operation.task.record,

          decision: operation.decision!,

          recentMessages: [],
        });

        return {
          operation,

          result,
        };
      }),
    );

    const groups: ProductAgentAnswer['groups'] = [];

    const focus: typeof workspace.focus = [];

    let handoffRequested = false;

    for (const {
      operation,

      result,
    } of outcomes) {
      const task = {
        ...operation.task,
      };

      const action = operation.decision?.proposal.action;

      const closed = operation.kind === 'remove' || action === 'COMPLETE';

      if (closed) {
        workspace.tasks = workspace.tasks.filter(
          (current) => current.taskId !== task.taskId,
        );
      } else if (result) {
        task.record = result.consultationRecord;

        task.question =
          action === 'CLARIFY' ? userFacingClarification(result.message) : null;

        const index = workspace.tasks.findIndex(
          (current) => current.taskId === task.taskId,
        );

        if (index < 0) {
          workspace.tasks.push(task);
        } else {
          workspace.tasks[index] = task;
        }

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

      if (action === 'HANDOFF') {
        handoffRequested = true;
      }

      const snapshot = task.record.results.active;

      const showProducts =
        action === 'SEARCH' || action === 'REFINE' || action === 'SHOW_RESULTS';

      const products =
        showProducts && snapshot
          ? snapshot.products.map((product) => ({
              id: product.productId,

              title: product.title,

              price: product.price,

              image: product.image ?? '',
            }))
          : [];

      const status = result?.failed
        ? 'failed'
        : closed
        ? 'closed'
        : action === 'CLARIFY'
        ? 'clarification'
        : showProducts && !snapshot
        ? 'failed'
        : showProducts && snapshot.products.length === 0
        ? 'empty'
        : 'ready';

      const rawMessage = result?.message ?? 'Готово.';

      groups.push({
        taskId: task.taskId,

        query: task.record.state?.search?.semanticIntent ?? task.query,

        status,

        message: productWorkspaceGroupMessage({
          status,

          showProducts,

          productsCount: products.length,

          message:
            action === 'CLARIFY'
              ? userFacingClarification(rawMessage)
              : rawMessage,
        }),

        products,

        consultation: result?.consultation ?? null,
      });
    }

    workspace.focus =
      focus.length > 0
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

      message: productWorkspaceMessage(groups),
    };
  };
}
