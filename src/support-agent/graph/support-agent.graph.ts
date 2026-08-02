import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { AiService } from '@/src/ai/ai.service';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { HumanMessage } from '@langchain/core/messages';

import { Command, END, START, StateGraph } from '@langchain/langgraph';

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

import { SupportAgentState } from './support-agent.state';

import { createIntentRouterNode } from './nodes/intent-router.node';

import { createOrchestratorNode } from './nodes/orchestrator.node';

import { createAggregateFinalAnswerNode } from './nodes/aggregate-final-answer.node';

import { rejectNode } from './nodes/reject.node';

import { clarificationTopicNode } from './nodes/clarification-topic.node';

import { clarificationQuestionNode } from './nodes/clarification-question.node';

import { createFaqSearchWorker } from './workers/faq-search.worker';

import { createProductSearchSubgraphWorker } from './workers/product-search-subgraph.worker';

import { afterIntentRoute } from './routers/after-intent.route';

import { dispatchWorkers } from './routers/dispatch-workers';

import { ProductAgentService } from '../product-agent/product-agent.service';

import { createProductSearchAgentGraph } from '../product-agent/product.agent.graph';
import { ClarificationResumeValue } from '../schemas/clarification-resume.schema';

@Injectable()
export class SupportAgentGraph implements OnModuleInit, OnModuleDestroy {
  private readonly graph;

  private readonly checkpointer: PostgresSaver;

  constructor(
    private readonly aiService: AiService,

    private readonly prismaService: PrismaService,

    private readonly productAgentService: ProductAgentService,
  ) {
    const postgresUri = process.env.POSTGRES_URI;

    if (!postgresUri) {
      throw new Error(
        'SupportAgentGraph: переменная POSTGRES_URI не определена',
      );
    }

    this.checkpointer = PostgresSaver.fromConnString(postgresUri);

    /**
     * ProductAgentService предоставляет
     * ProductAgentGraph доступ к поиску товаров.
     *
     * Сам compiled graph не инжектируется
     * через NestJS.
     */
    const productSearchAgentGraph = createProductSearchAgentGraph(
      this.aiService,
      this.productAgentService,
    );

    const intentRouterNode = createIntentRouterNode(this.aiService);

    const orchestratorNode = createOrchestratorNode(this.aiService);

    const faqSearchWorker = createFaqSearchWorker(
      this.aiService,
      this.prismaService,
    );

    const productSearchWorker = createProductSearchSubgraphWorker(
      productSearchAgentGraph,
    );

    const aggregateAnswerNode = createAggregateFinalAnswerNode(this.aiService);

    this.graph = new StateGraph(SupportAgentState)
      /**
       * Основные routing-ноды.
       */
      .addNode('intentRouterNode', intentRouterNode)

      .addNode('orchestratorNode', orchestratorNode)

      /**
       * Конечный неподдерживаемый ответ.
       */
      .addNode('reject', rejectNode)

      /**
       * Clarification-ноды.
       */
      .addNode('clarificationTopic', clarificationTopicNode)

      .addNode('clarificationQuestion', clarificationQuestionNode)

      /**
       * Workers основного support-agent.
       */
      .addNode('faqSearchWorker', faqSearchWorker)

      .addNode('productSearch', productSearchWorker)

      /**
       * Общая точка fan-in.
       */
      .addNode('aggregateAnswer', aggregateAnswerNode)

      /**
       * Начало графа.
       */
      .addEdge(START, 'intentRouterNode')

      /**
       * Роутинг после intent router.
       */
      .addConditionalEdges('intentRouterNode', afterIntentRoute, {
        orchestratorNode: 'orchestratorNode',

        reject: 'reject',

        clarificationTopic: 'clarificationTopic',

        clarificationQuestion: 'clarificationQuestion',
      })

      /**
       * Первый clarification:
       * пользователь выбирает тему.
       *
       * Затем выбирает конкретный вопрос.
       */
      .addEdge('clarificationTopic', 'clarificationQuestion')

      /**
       * Конкретный query анализируется заново.
       */
      .addEdge('clarificationQuestion', 'intentRouterNode')

      /**
       * Dynamic fan-out.
       *
       * Оркестратор может выбрать:
       *
       * - faqSearchWorker;
       * - productSearch;
       * - оба воркера.
       */
      .addConditionalEdges('orchestratorNode', dispatchWorkers, [
        'faqSearchWorker',
        'productSearch',
      ])

      /**
       * Fan-in.
       *
       * Все выбранные workers
       * сходятся в aggregateAnswer.
       */
      .addEdge('faqSearchWorker', 'aggregateAnswer')

      .addEdge('productSearch', 'aggregateAnswer')

      /**
       * Конечные переходы.
       */
      .addEdge('aggregateAnswer', END)

      .addEdge('reject', END)

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

  /**
   * Запуск нового пользовательского запроса.
   */
  invoke(query: string, threadId: string) {
    return this.graph.invoke(
      {
        query,

        messages: [new HumanMessage(query)],
      },
      {
        configurable: {
          thread_id: threadId,
        },
      },
    );
  }

  /**
   * Продолжение остановленного interrupt.
   *
   * threadId должен совпадать
   * с threadId первоначального invoke.
   */
  resume(
    value: ClarificationResumeValue,

    threadId: string,
  ) {
    return this.graph.invoke(
      new Command({
        resume: value,
      }),
      {
        configurable: {
          thread_id: threadId,
        },
      },
    );
  }
}
