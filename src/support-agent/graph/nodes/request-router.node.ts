import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { requestRouterHistoryTrimmer } from '../../context/history-context';

import { requestRouterPrompt } from '../../prompts/request-router.prompt';

import {
  RequestRouterModelSchema,
  RequestRouterSchema,
  RequestRouterWorkerSchema,
} from '../../schemas/request-router.schema';

import { readProductContext } from '../../../product-consultation/application/context/product-context.schema';

import { SupportAgentState } from '../support-agent.state';

function createRouterProductContext(value: unknown) {
  if (value == null) {
    return null;
  }

  const context = readProductContext(value);

  if (context.needs.length === 0) {
    return null;
  }

  const indexOf = (needId: string) =>
    context.needs.findIndex((need) => need.needId === needId) + 1;

  const presentation = (refs: typeof context.displayOrder) =>
    refs.map((ref, index) => ({
      position: index + 1,

      needIndex: indexOf(ref.needId),

      productId: ref.productId,
    }));

  const activeReferences = context.referenceOrder.length
    ? context.referenceOrder
    : context.comparison.length
    ? context.comparison
    : context.displayOrder;

  return {
    version: context.version,

    needs: context.needs.map((need, index) => ({
      needIndex: index + 1,

      semanticQuery: need.semanticQuery,

      filters: need.filters,

      preferences: need.preferences,

      productsCount: need.shownProducts.length,
    })),

    active: presentation(activeReferences),

    display: presentation(context.displayOrder),

    comparison: presentation(context.comparison),

    consultationSession: context.consultationSession
      ? {
          status: context.consultationSession.status,

          needIndexes: context.consultationSession.needIds
            .map(indexOf)
            .filter((index) => index > 0),

          completionReason: context.consultationSession.completionReason,
        }
      : null,

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

    const routerProductContext = createRouterProductContext(
      state.productContext,
    );

    const productContext = routerProductContext
      ? JSON.stringify(routerProductContext, null, 2)
      : 'null';

    const modelDecision = await chain.invoke({
      history,

      query: state.query,

      productContext,
    });

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
      const context = state.productContext
        ? readProductContext(state.productContext)
        : null;

      const hasProductContext = Boolean(context && context.needs.length > 0);

      if (hasProductContext) {
        workerQueries.productAgent = state.query;

        workers = ['productAgent'];

        fallbackRoute = null;

        clarificationTopic = null;

        handoffRequest = null;

        reason =
          'Deterministic fallback: сохранён ProductContext, запрос передан ProductAgent.';
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
