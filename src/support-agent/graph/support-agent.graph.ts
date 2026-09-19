import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { HumanMessage } from '@langchain/core/messages';

import { Command, END, START, StateGraph } from '@langchain/langgraph';

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { AiService } from '@/src/ai/ai.service';

import { StoreKnowledgeService } from '@/src/store-knowledge/store-knowledge.service';

import { createCustomerHelpAgent } from '../agents/customer-help-agent/customer-help.agent';

import { createHandoffAgentGraph } from '../agents/handoff-agent/handoff-agent.graph';

import { handoffResultNode } from '../agents/handoff-agent/nodes/handoff-result.node';

import { submitConsultationFeedback as applyConsultationFeedback } from '../agents/product-agent/consultation-session';

import { ProductAgentService } from '../agents/product-agent/product-agent.service';

import { createProductAgent } from '../agents/product-agent/product.agent';

import {
  ConsultationFeedbackReceiptSchema,
  type ConsultationFeedbackReceipt,
} from '../agents/product-agent/schemas/consultation-lifecycle.schema';

import {
  SUPPORT_AGENT_AI_NODE_RETRY_POLICY,
  SUPPORT_AGENT_AI_NODE_TIMEOUT_MS,
  SUPPORT_AGENT_PRODUCT_NODE_TIMEOUT_MS,
} from '../config/support-agent-execution.config';

import { RequestRouterWorkerSchema } from '../schemas/request-router.schema';

import { readProductContext } from '../schemas/product-context.schema';

import { SupportAgentResumeValue } from '../schemas/support-agent-resume.schema';

import { createAggregateFinalAnswerNode } from './nodes/aggregate-final-answer.node';

import { clarificationQuestionNode } from './nodes/clarification-question.node';

import { clarificationTopicNode } from './nodes/clarification-topic.node';

import { preIntentNode } from './nodes/pre-intent.node';

import { rejectNode } from './nodes/reject.node';

import { createRequestRouterNode } from './nodes/request-router.node';

import { afterPreIntentRoute } from './routers/after-pre-intent.route';

import { afterRequestRoute } from './routers/after-request.route';

import { SupportAgentState } from './support-agent.state';

import { createCustomerHelpAgentWorker } from './workers/customer-help-agent.worker';

import { createProductAgentWorker } from './workers/product-agent.worker';

@Injectable()
export class SupportAgentGraph implements OnModuleInit, OnModuleDestroy {
  private readonly graph;

  private readonly checkpointer: PostgresSaver;

  constructor(
    private readonly aiService: AiService,

    private readonly productAgentService: ProductAgentService,

    private readonly storeKnowledgeService: StoreKnowledgeService,
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

    const customerHelpWorker = createCustomerHelpAgentWorker(customerHelpAgent);

    const productAgentWorker = createProductAgentWorker(productAgent);

    const aggregateAnswerNode = createAggregateFinalAnswerNode(this.aiService);

    const agentNodes = RequestRouterWorkerSchema.options;

    this.graph = new StateGraph(SupportAgentState)
      .addNode('preIntentNode', preIntentNode)

      .addNode('requestRouterNode', requestRouterNode, {
        retryPolicy: SUPPORT_AGENT_AI_NODE_RETRY_POLICY,

        timeout: SUPPORT_AGENT_AI_NODE_TIMEOUT_MS,
      })

      .addNode('reject', rejectNode)

      .addNode('clarificationTopic', clarificationTopicNode)

      .addNode('clarificationQuestion', clarificationQuestionNode)

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

        customerHelpAgent: 'customerHelpAgent',

        reject: 'reject',

        clarificationTopic: 'clarificationTopic',

        clarificationQuestion: 'clarificationQuestion',

        handoffAgent: 'handoffAgent',
      })

      .addEdge('clarificationTopic', 'clarificationQuestion')

      .addEdge('clarificationQuestion', 'preIntentNode')

      .addEdge('aggregateAnswer', END)

      .addEdge('reject', END)

      .addEdge('handoffAgent', 'handoffResult')

      .addEdge('handoffResult', END)

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

  invoke(
    query: string,

    threadId: string,

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

            ...(messageId
              ? {
                  id: messageId,
                }
              : {}),
          }),
        ],
      },
      {
        configurable: {
          thread_id: threadId,
        },

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

  streamEvents(query: string, threadId: string) {
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
      },
    );
  }

  resume(
    value: SupportAgentResumeValue,

    threadId: string,

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
