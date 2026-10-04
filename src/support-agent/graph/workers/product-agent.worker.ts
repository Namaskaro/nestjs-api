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

export function createProductAgentWorker(
  productAgent: ProductAgent,
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    await dispatchCustomEvent(
      'assistant_status',
      {
        status: 'SEARCHING_PRODUCTS',
      },
      config,
    );

    const result = await productAgent.invoke({
      query: state.query,

      conversationId: conversationIdFromConfig(config),

      requestId: requestIdFromState(state),

      recentMessages: recentMessagesFromState(state),

      workspace:
        state.productWorkspace ??
        createProductWorkspace(state.productConsultationRecord),
    });

    const workspace = result.workspace;

    if (result.handoffRequested) {
      return new Command({
        goto: 'handoffAgent',

        update: {
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

      groups: result.groups,

      consultation: result.consultation,

      consultationCompletion: result.consultationCompletion,
    };

    if (state.executionMode === 'multi') {
      const workerResult = ProductSearchAnswerBlockSchema.parse({
        worker: 'product_search',

        data,
      });

      return new Command({
        goto: 'aggregateAnswer',

        update: {
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

        productWorkspace: workspace,

        productConsultationRecord: null,

        answer,

        messages: [new AIMessage(answer.message)],
      },
    });
  };
}
