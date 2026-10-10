import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';

import { AIMessage, HumanMessage } from '@langchain/core/messages';

import {
  Command,
  END,
  type GraphNode,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

import { SupportAgentState } from '@/src/support-agent/graph/support-agent.state';

import {
  ProductAgentFinalAnswerSchema,
  ProductSearchAnswerBlockSchema,
} from '@/src/support-agent/schemas/support-agent-answer.schema';

import { ConsultationRequestIdSchema } from '@/src/product-consultation/application/runtime/consultation-application-record';

import { createProductWorkspace } from '@/src/product-consultation/application/workspace/product-workspace';

import type { ProductConsultationContextMessage } from '@/src/product-consultation/application/context/product-consultation-context';

import { readProductContext } from '@/src/product-consultation/application/context/product-context.schema';

import {
  buildConsultationCompletionPresentation,
  completeConsultationSession,
  touchConsultationSession,
} from '@/src/product-consultation/application/session/consultation-session';

import { ProductAgent } from '@/src/product-consultation/application/agent/product.agent';

function conversationIdFromConfig(config: LangGraphRunnableConfig): string {
  const threadId = config.configurable?.thread_id;

  if (typeof threadId !== 'string' || !threadId.trim()) {
    throw new Error('ProductAgentWorker: thread_id отсутствует');
  }

  return threadId.trim();
}

function requestIdFromState(state: typeof SupportAgentState.State): string {
  const messageId = state.messages.at(-1)?.id;

  if (typeof messageId === 'string' && messageId.trim()) {
    return ConsultationRequestIdSchema.parse(messageId);
  }

  return ConsultationRequestIdSchema.parse(`message-${state.messages.length}`);
}

function sourceQueryFromState(state: typeof SupportAgentState.State): string {
  const message = state.messages.at(-1);

  if (message && HumanMessage.isInstance(message)) {
    const text = message.text.trim();

    if (text) {
      return text.slice(0, 4000);
    }
  }

  return state.query.trim().slice(0, 4000);
}

function recentMessagesFromState(
  state: typeof SupportAgentState.State,
): ProductConsultationContextMessage[] {
  const result: ProductConsultationContextMessage[] = [];

  for (const message of state.messages.slice(0, -1)) {
    const text = message.text.trim().slice(0, 4000);

    if (!text) {
      continue;
    }

    if (HumanMessage.isInstance(message)) {
      result.push({
        role: 'user',
        text,
      });

      continue;
    }

    if (AIMessage.isInstance(message)) {
      result.push({
        role: 'assistant',
        text,
      });
    }
  }

  return result.slice(-6);
}

function groupsForPresentation<
  T extends {
    products: unknown[];
  },
>(groups: readonly T[]): T[] {
  return groups.filter((group) => group.products.length > 0);
}

export function createProductAgentWorker(
  productAgent: ProductAgent,
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    await dispatchCustomEvent(
      'assistant_status',
      {
        status: 'THINKING',
      },
      config,
    );

    const productContext = readProductContext(state.productContext);

    touchConsultationSession(productContext, []);

    const result = await productAgent.invoke(
      {
        query: state.query,
        sourceQuery: sourceQueryFromState(state),
        conversationId: conversationIdFromConfig(config),
        requestId: requestIdFromState(state),
        recentMessages: recentMessagesFromState(state),
        workspace:
          state.productWorkspace ??
          createProductWorkspace(state.productConsultationRecord),
      },
      config,
    );

    const workspace = result.workspace;

    let consultationCompletion = result.consultationCompletion;

    if (result.completionRequested) {
      const completed = completeConsultationSession(productContext, {
        reason: 'USER_DONE',
      });

      consultationCompletion =
        buildConsultationCompletionPresentation(completed);
    }

    if (result.handoffRequested) {
      return new Command({
        goto: 'handoffAgent',
        update: {
          productContext,
          productWorkspace: workspace,
          productConsultationRecord: null,
          handoffRequest: {
            reason: 'CUSTOMER_REQUEST',
            trigger: 'EXPLICIT_USER_REQUEST',
          },
          workerResults: [],
        },
      });
    }

    if (!result.message) {
      throw new Error('ProductAgentWorker: ProductAgent не вернул message');
    }

    const data = {
      message: result.message,
      groups: groupsForPresentation(result.groups),
      resultGroups: result.groups,
      consultation: result.consultation,
      consultationCompletion,
    };

    if (state.executionMode === 'multi') {
      const workerResult = ProductSearchAnswerBlockSchema.parse({
        worker: 'product_search',
        data,
      });

      return new Command({
        goto: 'aggregateAnswer',
        update: {
          productContext,
          productWorkspace: workspace,
          productConsultationRecord: null,
          workerResults: [workerResult],
        },
      });
    }

    const answer = ProductAgentFinalAnswerSchema.parse({
      type: 'product_agent',
      ...data,
    });

    return new Command({
      goto: END,
      update: {
        activeAgent: 'productAgent',
        productContext,
        productWorkspace: workspace,
        productConsultationRecord: null,
        answer,
        messages: [new AIMessage(answer.message)],
      },
    });
  };
}
