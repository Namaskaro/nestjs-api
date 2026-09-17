import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { requestRouterHistoryTrimmer } from '../../context/history-context';

import { requestRouterPrompt } from '../../prompts/request-router.prompt';

import {
  RequestRouterModelSchema,
  RequestRouterSchema,
  RequestRouterWorkerSchema,
} from '../../schemas/request-router.schema';

import { SupportAgentState } from '../support-agent.state';

// ===== START CHANGE — COMPACT PRODUCT CONTEXT FOR ROUTER =====

function createRouterProductContext(
  context: typeof SupportAgentState.State.productContext,
) {
  if (!context) {
    return null;
  }

  const indexOf = (needId: string) =>
    context.needs.findIndex((need) => need.needId === needId) + 1;

  return {
    version: context.version,

    needs: context.needs.map((need, index) => ({
      needIndex: index + 1,

      semanticQuery: need.semanticQuery,

      filters: need.filters,

      preferences: need.preferences,

      productsCount: need.shownProducts.length,
    })),

    display: context.displayOrder.map((reference, index) => ({
      position: index + 1,

      needIndex: indexOf(reference.needId),
    })),

    comparison: context.comparison.map((reference, index) => ({
      position: index + 1,

      needIndex: indexOf(reference.needId),
    })),

    pendingClarification: context.pendingClarification
      ? {
          kind: context.pendingClarification.kind,

          question: context.pendingClarification.question,

          fields: context.pendingClarification.fields,

          proposal: context.pendingClarification.proposal,

          needIndex: context.pendingClarification.needId
            ? indexOf(context.pendingClarification.needId)
            : null,
        }
      : null,
  };
}

// ===== END CHANGE — COMPACT PRODUCT CONTEXT FOR ROUTER =====

export function createRequestRouterNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getYandexLiteChatModel();

  const structuredRouter = model.withStructuredOutput(
    RequestRouterModelSchema,
    {
      name: 'route_support_request',
    },
  );

  const chain = requestRouterPrompt.pipe(structuredRouter);

  return async (state) => {
    const history = await requestRouterHistoryTrimmer.invoke(
      state.messages.slice(0, -1),
    );

    // ===== START CHANGE — DO NOT SEND FULL PRODUCT CONTEXT =====

    const routerProductContext = createRouterProductContext(
      state.productContext,
    );

    const productContext = routerProductContext
      ? JSON.stringify(routerProductContext, null, 2)
      : 'null';

    // ===== END CHANGE — DO NOT SEND FULL PRODUCT CONTEXT =====

    const modelDecision = await chain.invoke({
      history,

      query: state.query,

      productContext,
    });

    const workers = RequestRouterWorkerSchema.options.filter(
      (worker) => modelDecision.workerQueries[worker] !== null,
    );

    const route = workers.length > 0 ? 'execute' : modelDecision.fallbackRoute;

    if (!route) {
      throw new Error(
        [
          'RequestRouterNode: модель не выбрала worker',
          'и не указала fallbackRoute',
        ].join(' '),
      );
    }

    if (route === 'handoff' && !modelDecision.handoffRequest) {
      throw new Error(
        'RequestRouterNode: для handoff отсутствует handoffRequest',
      );
    }

    const decision = RequestRouterSchema.parse({
      route,

      workers,

      workerQueries: modelDecision.workerQueries,

      clarificationTopic:
        route === 'clarification' ? modelDecision.clarificationTopic : null,

      handoffRequest: route === 'handoff' ? modelDecision.handoffRequest : null,

      reason: modelDecision.reason,
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
