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

import {
  createConsultationApplicationRecord,
  ConsultationRequestIdSchema,
  type ConsultationApplicationRecord,
} from '@/src/product-consultation/application/runtime/consultation-application-record';

import type { PublicConsultationAction } from '@/src/product-consultation/core/turn/consultation-turn.schema';

import type { ProductConsultationContextMessage } from '@/src/product-consultation/application/context/product-consultation-context';

import { ProductAgent } from '@/src/product-consultation/application/agent/product.agent';

const GROUP_ACTIONS = new Set<PublicConsultationAction>([
  'SEARCH',
  'REFINE',
  'SHOW_RESULTS',
]);

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

function answerGroups(input: {
  record: ConsultationApplicationRecord;

  action: PublicConsultationAction | null;
}) {
  if (input.action === null || !GROUP_ACTIONS.has(input.action)) {
    return [];
  }

  const snapshot = input.record.results.active;

  if (snapshot === null) {
    return [];
  }

  return [
    {
      query: snapshot.search.semanticIntent,

      message:
        snapshot.products.length > 0
          ? 'Найденные товары.'
          : 'Товары не найдены.',

      products: snapshot.products.map((product) => ({
        id: product.productId,

        title: product.title,

        price: product.price,

        image: product.image ?? '',
      })),
    },
  ];
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

      consultationRecord:
        state.productConsultationRecord ??
        createConsultationApplicationRecord(),

      productContext: state.productContext,
    });

    const record = result.consultationRecord;

    const decision = result.decision;

    if (decision?.proposal.action === 'HANDOFF') {
      return new Command({
        goto: 'handoffAgent',

        update: {
          productConsultationRecord: record,

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

    const groups = answerGroups({
      record,

      action: decision?.proposal.action ?? null,
    });

    const data = {
      message: result.message,

      groups,

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
          productConsultationRecord: record,

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

        productConsultationRecord: record,

        answer,

        messages: [new AIMessage(answer.message)],
      },
    });
  };
}
