import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { SupportCaseStatus } from '@/prisma/generated';

import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { Command, END, START, StateGraph } from '@langchain/langgraph';

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { AiService } from '@/src/ai/ai.service';

import { StoreKnowledgeService } from '@/src/store-knowledge/store-knowledge.service';

import { OrdersService } from '@/src/modules/orders/orders.service';

import { RefundService } from '@/src/modules/orders/refund/refund.service';

import { OrderCancellationCaseService } from '@/src/modules/orders/cancellation/order-cancellation-case.service';

import { createCustomerHelpAgent } from '../agents/customer-help-agent/customer-help.agent';

import { createHandoffAgentGraph } from '../agents/handoff-agent/handoff-agent.graph';

import { handoffResultNode } from '../agents/handoff-agent/nodes/handoff-result.node';

import {
  markConsultationSessionHandedOff,
  submitConsultationFeedback as applyConsultationFeedback,
} from '@/src/product-consultation/application/session/consultation-session';

import {
  ConsultationFeedbackReceiptSchema,
  type ConsultationFeedbackReceipt,
} from '@/src/product-consultation/application/session/consultation-lifecycle.schema';

import {
  SUPPORT_AGENT_AI_NODE_RETRY_POLICY,
  SUPPORT_AGENT_AI_NODE_TIMEOUT_MS,
  SUPPORT_AGENT_PRODUCT_NODE_TIMEOUT_MS,
} from '../config/support-agent-execution.config';

import { RequestRouterWorkerSchema } from '../schemas/request-router.schema';

import { readProductContext } from '@/src/product-consultation/application/context/product-context.schema';

import { SupportAgentResumeValue } from '../schemas/support-agent-resume.schema';

import {
  SupportAgentContextSchema,
  type SupportAgentContext,
} from '../context/support-agent-context.schema';

import { createAggregateFinalAnswerNode } from './nodes/aggregate-final-answer.node';

import { createClarificationQuestionNode } from './nodes/clarification-question.node';

import { createClarificationTopicNode } from './nodes/clarification-topic.node';

import { preIntentNode } from './nodes/pre-intent.node';

import { rejectNode } from './nodes/reject.node';

import { createRequestRouterNode } from './nodes/request-router.node';

import { afterPreIntentRoute } from './routers/after-pre-intent.route';

import { afterRequestRoute } from './routers/after-request.route';

import { SupportAgentState } from './support-agent.state';

import { createCustomerHelpAgentWorker } from './workers/customer-help-agent.worker';

import { createProductAgentWorker } from './workers/product-agent.worker';

import {
  createOrderAgentWorker,
  createConfirmOrderCancellationNode,
} from './workers/order-agent.worker';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { createProductAgent } from '@/src/product-consultation/application/agent/product.agent';

@Injectable()
export class SupportAgentGraph implements OnModuleInit, OnModuleDestroy {
  private readonly graph;

  private readonly checkpointer: PostgresSaver;

  constructor(
    private readonly aiService: AiService,
    private readonly productAgentService: ProductAgentService,
    private readonly storeKnowledgeService: StoreKnowledgeService,
    private readonly ordersService: OrdersService,
    private readonly refundService: RefundService,
    private readonly cancellationCaseService: OrderCancellationCaseService,
  ) {
    const postgresUri = process.env.POSTGRES_URI;

    this.checkpointer = PostgresSaver.fromConnString(postgresUri, {
      schema: 'langgraph',
    });

    const productAgent = createProductAgent(
      this.aiService,
      this.productAgentService,
    );

    const customerHelpAgent = createCustomerHelpAgent(
      this.aiService,
      this.storeKnowledgeService,
    );

    const handoffAgentGraph = createHandoffAgentGraph(this.aiService);

    const requestRouterNode = createRequestRouterNode(this.aiService);

    const clarificationTopicNode = createClarificationTopicNode(
      this.storeKnowledgeService,
    );

    const clarificationQuestionNode = createClarificationQuestionNode(
      this.storeKnowledgeService,
    );

    const customerHelpWorker = createCustomerHelpAgentWorker(customerHelpAgent);

    const productAgentWorker = createProductAgentWorker(productAgent);

    const orderAgentWorker = createOrderAgentWorker(this.ordersService);

    const confirmOrderCancellationNode = createConfirmOrderCancellationNode(
      this.ordersService,
      this.refundService,
      this.cancellationCaseService,
    );

    const aggregateAnswerNode = createAggregateFinalAnswerNode(this.aiService);

    const agentNodes = RequestRouterWorkerSchema.options;

    this.graph = new StateGraph(SupportAgentState, SupportAgentContextSchema)
      .addNode('preIntentNode', preIntentNode)

      .addNode('requestRouterNode', requestRouterNode, {
        retryPolicy: SUPPORT_AGENT_AI_NODE_RETRY_POLICY,
        timeout: SUPPORT_AGENT_AI_NODE_TIMEOUT_MS,
      })

      .addNode('reject', rejectNode)

      .addNode('clarificationTopic', clarificationTopicNode)

      .addNode('clarificationQuestion', clarificationQuestionNode, {
        ends: [END, 'preIntentNode', 'productAgent', 'orderAgent'],
      })

      .addNode('customerHelpAgent', customerHelpWorker, {
        ends: [END, 'aggregateAnswer', 'handoffAgent', ...agentNodes],

        retryPolicy: SUPPORT_AGENT_AI_NODE_RETRY_POLICY,
        timeout: SUPPORT_AGENT_AI_NODE_TIMEOUT_MS,
      })

      .addNode('productAgent', productAgentWorker, {
        ends: [END, 'aggregateAnswer', 'handoffAgent', ...agentNodes],

        retryPolicy: SUPPORT_AGENT_AI_NODE_RETRY_POLICY,
        timeout: SUPPORT_AGENT_PRODUCT_NODE_TIMEOUT_MS,
      })

      .addNode('orderAgent', orderAgentWorker, {
        ends: [END, 'aggregateAnswer', 'confirmOrderCancellation'],
      })

      .addNode('confirmOrderCancellation', confirmOrderCancellationNode, {
        ends: [END, 'aggregateAnswer'],
      })

      .addNode('aggregateAnswer', aggregateAnswerNode)

      .addNode('handoffAgent', handoffAgentGraph)

      .addNode('handoffResult', handoffResultNode)

      .addEdge(START, 'preIntentNode')

      .addConditionalEdges('preIntentNode', afterPreIntentRoute, {
        productAgent: 'productAgent',
        customerHelpAgent: 'customerHelpAgent',
        requestRouterNode: 'requestRouterNode',
        reject: 'reject',
        clarificationTopic: 'clarificationTopic',
      })

      .addConditionalEdges('requestRouterNode', afterRequestRoute, {
        productAgent: 'productAgent',
        orderAgent: 'orderAgent',
        customerHelpAgent: 'customerHelpAgent',
        reject: 'reject',
        clarificationTopic: 'clarificationTopic',
        clarificationQuestion: 'clarificationQuestion',
        handoffAgent: 'handoffAgent',
      })

      .addEdge('clarificationTopic', 'clarificationQuestion')

      .addEdge('aggregateAnswer', END)

      .addEdge('reject', END)

      .addEdge('handoffAgent', 'handoffResult')

      .compile({
        checkpointer: this.checkpointer,
      });
  }

  async onModuleInit(): Promise<void> {
    await this.checkpointer.setup();
  }

  async onModuleDestroy(): Promise<void> {
    await this.checkpointer.end();
  }

  getCompiledGraph() {
    return this.graph;
  }

  async hasPendingInterrupt(threadId: string): Promise<boolean> {
    const snapshot = await this.graph.getState({
      configurable: {
        thread_id: threadId,
      },
    });

    return snapshot.tasks.some((task) => (task.interrupts?.length ?? 0) > 0);
  }

  async synchronizeOperatorHandoff(
    threadId: string,
    caseId: string,
    status: SupportCaseStatus,
  ): Promise<void> {
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    const snapshot = await this.graph.getState(config);

    if (!snapshot.values.messages?.length) {
      return;
    }

    const isClosed =
      status === SupportCaseStatus.RESOLVED ||
      status === SupportCaseStatus.CANCELLED;

    const stage = isClosed ? 'closed' : 'opened';

    const eventId = `operator-handoff:${stage}:${caseId}`;

    if (snapshot.values.messages.some((message) => message.id === eventId)) {
      return;
    }

    const eventText = isClosed
      ? 'Операторское обращение завершено. Покупатель снова может общаться с AI-ассистентом. Подробности разговора с оператором в контекст AI не передавались.'
      : 'Операторское обращение зарегистрировано. Общение с AI приостановлено до завершения операторского обращения.';

    const productContext =
      snapshot.values.productContext == null
        ? null
        : readProductContext(snapshot.values.productContext);

    if (!isClosed && productContext) {
      markConsultationSessionHandedOff(productContext);
    }

    await this.graph.updateState(
      config,
      {
        activeAgent: null,
        handoffRequest: null,
        handoff: null,
        answer: null,
        pendingOrderAction: null,

        ...(productContext ? { productContext } : {}),

        messages: [
          new AIMessage({
            id: eventId,
            content: eventText,
          }),
        ],
      },
      'handoffResult',
    );
  }

  invoke(
    query: string,
    threadId: string,
    context: SupportAgentContext,
    onCustomEvent?: (
      eventName: string,
      payload: unknown,
    ) => void | Promise<void>,
    messageId?: string,
  ) {
    return this.graph.invoke(
      {
        query,

        messages: [
          new HumanMessage({
            content: query,
            ...(messageId ? { id: messageId } : {}),
          }),
        ],
      },

      {
        configurable: {
          thread_id: threadId,
        },

        context,

        callbacks: onCustomEvent
          ? [
              {
                handleCustomEvent: onCustomEvent,
              },
            ]
          : undefined,
      },
    );
  }

  streamEvents(query: string, threadId: string, context: SupportAgentContext) {
    return this.graph.streamEvents(
      {
        query,
        messages: [new HumanMessage(query)],
      },

      {
        version: 'v3',

        configurable: {
          thread_id: threadId,
        },

        context,
      },
    );
  }

  resume(
    value: SupportAgentResumeValue,
    threadId: string,
    context: SupportAgentContext,
    onCustomEvent?: (
      eventName: string,
      payload: unknown,
    ) => void | Promise<void>,
  ) {
    return this.graph.invoke(
      new Command({
        resume: value,
      }),

      {
        configurable: {
          thread_id: threadId,
        },

        context,

        callbacks: onCustomEvent
          ? [
              {
                handleCustomEvent: onCustomEvent,
              },
            ]
          : undefined,
      },
    );
  }

  resumeEvents(
    value: SupportAgentResumeValue,
    threadId: string,
    context: SupportAgentContext,
  ) {
    return this.graph.streamEvents(
      new Command({
        resume: value,
      }),

      {
        version: 'v3',

        configurable: {
          thread_id: threadId,
        },

        context,
      },
    );
  }

  async submitConsultationFeedback(
    threadId: string,
    sessionId: string,
    helpful: boolean,
  ): Promise<ConsultationFeedbackReceipt> {
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    const snapshot = await this.graph.getState(config);

    const productContext = readProductContext(snapshot.values.productContext);

    const feedback = applyConsultationFeedback(productContext, {
      sessionId,
      helpful,
      source: 'BUTTON',
    });

    await this.graph.updateState(config, {
      productContext: readProductContext(productContext),
    });

    return ConsultationFeedbackReceiptSchema.parse(feedback);
  }
}
