import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { requestRouterHistoryTrimmer } from '../../context/history-context';

import { requestRouterPrompt } from '../../prompts/request-router.prompt';

import {
  RequestRouterModelSchema,
  RequestRouterSchema,
  RequestRouterWorkerSchema,
} from '../../schemas/request-router.schema';

import { ConsultationApplicationRecordSchema } from '@/src/product-consultation/application/runtime/consultation-application-record';

import { SupportAgentState } from '../support-agent.state';

function createRouterProductContext(value: unknown) {
  if (value == null) {
    return null;
  }

  const record = ConsultationApplicationRecordSchema.parse(value);

  if (
    record.state === null &&
    record.results.active === null &&
    record.results.lastConfirmed === null
  ) {
    return null;
  }

  const snapshot = record.results.active ?? record.results.lastConfirmed;

  return {
    generation: record.generation,

    task:
      record.state === null
        ? null
        : {
            search:
              record.state.search === null
                ? null
                : {
                    semanticIntent: record.state.search.semanticIntent,

                    category: record.state.search.category,

                    constraints: record.state.search.constraints,
                  },

            goals: record.state.memory.memory.goals.map((goal) => goal.text),
          },

    results: {
      status:
        record.results.pendingSearch !== null
          ? 'pending'
          : record.results.active !== null
          ? 'active'
          : record.results.lastFailure !== undefined
          ? 'failure'
          : 'idle',

      shownProducts:
        snapshot?.products.map((product, index) => ({
          position: index + 1,

          title: product.title,

          price: product.price,
        })) ?? [],
    },
  };
}

export function createRequestRouterNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getYandexLiteChatModel();

  const structuredRouter = model.withStructuredOutput(
    RequestRouterModelSchema,
    {
      name: 'route_support_request',

      includeRaw: true,
    },
  );

  const chain = requestRouterPrompt.pipe(structuredRouter);

  return async (state) => {
    const history = await requestRouterHistoryTrimmer.invoke(
      state.messages.slice(0, -1),
    );

    const routerProductContext = createRouterProductContext(
      state.productConsultationRecord,
    );

    const productContext = routerProductContext
      ? JSON.stringify(routerProductContext, null, 2)
      : 'null';

    const response = await chain.invoke({
      history,

      query: state.query,

      productContext,
    });

    const modelDecision = RequestRouterModelSchema.parse(response.parsed);

    const workerQueries = {
      ...modelDecision.workerQueries,
    };

    let workers = RequestRouterWorkerSchema.options.filter(
      (worker) => workerQueries[worker] !== null,
    );

    let fallbackRoute = modelDecision.fallbackRoute;

    let clarificationTopic = modelDecision.clarificationTopic;

    let handoffRequest = modelDecision.handoffRequest;

    let reason = modelDecision.reason;

    if (workers.length === 0 && !fallbackRoute) {
      if (routerProductContext !== null) {
        workerQueries.productAgent = state.query;

        workers = ['productAgent'];

        fallbackRoute = null;

        clarificationTopic = null;

        handoffRequest = null;

        reason =
          'Deterministic fallback: сохранена активная товарная консультация.';
      } else {
        fallbackRoute = 'clarification';

        clarificationTopic = null;

        handoffRequest = null;

        reason = 'Deterministic fallback: модель не выбрала domain agent.';
      }
    }

    if (
      workers.length === 0 &&
      fallbackRoute === 'handoff' &&
      !handoffRequest
    ) {
      fallbackRoute = 'clarification';

      clarificationTopic = null;

      handoffRequest = null;

      reason =
        'Deterministic fallback: модель выбрала handoff без handoffRequest.';
    }

    const route =
      workers.length > 0 ? 'execute' : fallbackRoute ?? 'clarification';

    const decision = RequestRouterSchema.parse({
      route,

      workers,

      workerQueries,

      clarificationTopic: route === 'clarification' ? clarificationTopic : null,

      handoffRequest: route === 'handoff' ? handoffRequest : null,

      reason,
    });

    const executionMode =
      decision.route === 'execute'
        ? decision.workers.length > 1
          ? 'multi'
          : 'single'
        : null;

    return {
      requestRouter: decision,

      executionMode,

      clarification: null,

      handoffRequest:
        decision.route === 'handoff' ? decision.handoffRequest : null,

      workerResults: [],

      answer: null,
    };
  };
}
