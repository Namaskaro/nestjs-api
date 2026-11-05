import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ConsultationApplicationRecordSchema } from '@/src/product-consultation/application/runtime/consultation-application-record';

import { requestRouterHistoryTrimmer } from '../../context/history-context';

import { requestRouterPrompt } from '../../prompts/request-router.prompt';

import {
  RequestRouterModelSchema,
  RequestRouterSchema,
  RequestRouterWorkerSchema,
} from '../../schemas/request-router.schema';

import type { OrderAction } from '../../schemas/order-request.schema';

import { SupportAgentState } from '../support-agent.state';

const CUSTOMER_HELP_TOPIC_PATTERN =
  /(?:достав\p{L}*|оплат\p{L}*|возврат\p{L}*|обмен\p{L}*|скид\p{L}*|лояль\p{L}*|претенз\p{L}*)/iu;

const CUSTOMER_HELP_REQUEST_CUE_PATTERN =
  /(?:расскаж\p{L}*|подскаж\p{L}*|объясн\p{L}*|информац\p{L}*|услов\p{L}*|срок\p{L}*|стоим\p{L}*|способ\p{L}*|правил\p{L}*|можно\s+ли|есть\s+ли)/iu;

const EXCLUSIVE_ORDER_ACTIONS = new Set<OrderAction>([
  'CANCEL',
  'RETURN_REQUEST',
  'EXCHANGE_REQUEST',
  'CLAIM_REQUEST',
]);

type OrderAssistanceAction = Extract<
  OrderAction,
  'RETURN_REQUEST' | 'EXCHANGE_REQUEST' | 'CLAIM_REQUEST'
>;

/**
 * Определяет публичный номер заказа
 * только тогда, когда он явно указан
 * в текущем сообщении пользователя.
 *
 * Не извлекаем номер из истории
 * и не создаём идентификаторы самостоятельно.
 */
function extractOrderNumber(query: string): string | null {
  const match = query.match(
    /(?:заказ(?:а|у|ом|е)?\s*(?:(?:№|#)\s*|номер\s+)?|[№#]\s*)(\d{1,16})/iu,
  );

  return match?.[1] ?? null;
}

/**
 * Распознаём только достаточно явные
 * просьбы выполнить операцию.
 *
 * Вопросы "как оформить", "какие условия",
 * "можно ли вернуть" сюда не попадают.
 *
 * Не пытаемся заменить этим классификатором
 * весь RequestRouter.
 */
export function inferExplicitOrderAssistance(
  query: string,
): OrderAssistanceAction | null {
  const text = query.toLowerCase().trim();

  if (!text) {
    return null;
  }

  /*
   * Прямая просьба о человеке имеет приоритет.
   * Её должен обрабатывать обычный Handoff Flow.
   */
  const directOperatorRequest =
    /(?:позови|позовите|пригласи|пригласите|подключи|подключите|соедини|соедините).{0,40}(?:оператор|сотрудник|человек)/iu;

  if (directOperatorRequest.test(text)) {
    return null;
  }

  /*
   * Информационные вопросы не должны
   * запускать операции над заказами.
   */
  const informationalQuestion =
    /^(?:как|каким\s+образом|какие|каковы|сколько|почему|можно\s+ли|что\s+нужно|хочу\s+узнать|подскажите?\s*,?\s*как|расскажите?\s*,?\s*как)(?:\s|[,.!?]|$)/iu;

  if (informationalQuestion.test(text)) {
    return null;
  }

  /*
   * Покупатель явно просит совершить действие:
   *
   * "Хочу оформить..."
   * "Нужно вернуть..."
   * "Прошу зарегистрировать..."
   * "Оформите..."
   *
   * Обычное упоминание возврата или претензии
   * само по себе недостаточно.
   */
  const actionRequest =
    /(?:^|[\s,.!?])(?:хочу|прошу|требую|надо|нужно|желаю)\s+(?:(?:сейчас|официально)\s+)?(?:оформить|подать|зарегистрировать|вернуть|обменять|заменить|поменять)|(?:^|[\s,.!?])(?:оформите|примите|зарегистрируйте|верните|обменяйте|замените|поменяйте)(?:\s|$)/iu;

  if (!actionRequest.test(text)) {
    return null;
  }

  /*
   * Претензия имеет приоритет перед
   * обычным возвратом, если покупатель
   * сообщает о повреждении или браке.
   */
  const claimPattern =
    /(?:претенз\p{L}*|жалоб\p{L}*|поврежд\p{L}*|брак\p{L}*|не\s+тот\s+товар|списали\s+дважды|списали\s+лишнее)/iu;

  if (claimPattern.test(text)) {
    return 'CLAIM_REQUEST';
  }

  const exchangePattern = /(?:обмен\p{L}*|замен\p{L}*|поменять)/iu;

  if (exchangePattern.test(text)) {
    return 'EXCHANGE_REQUEST';
  }

  const returnPattern = /(?:возврат\p{L}*|вернуть|верните|верну)/iu;

  if (returnPattern.test(text)) {
    /*
     * Возврат денег за отменённый заказ —
     * отдельный финансовый процесс.
     *
     * Не смешиваем его с возвратом
     * уже полученного товара.
     */
    const moneyOnlyRequest =
      /(?:вернуть|возврат)\s+(?:деньги|денежные\s+средства|оплату)/iu;

    const physicalGoodsMentioned =
      /(?:товар\p{L}*|вещ\p{L}*|получен\p{L}*|доставлен\p{L}*|куртк\p{L}*|кроссовк\p{L}*)/iu;

    if (moneyOnlyRequest.test(text) && !physicalGoodsMentioned.test(text)) {
      return null;
    }

    return 'RETURN_REQUEST';
  }

  return null;
}

export function inferCustomerHelpWorkerQuery(query: string): string | null {
  const text = query.trim().slice(0, 4000);

  if (
    !CUSTOMER_HELP_TOPIC_PATTERN.test(text) ||
    !CUSTOMER_HELP_REQUEST_CUE_PATTERN.test(text)
  ) {
    return null;
  }

  const topicMatch = text.match(CUSTOMER_HELP_TOPIC_PATTERN);

  const cueMatch = text.match(CUSTOMER_HELP_REQUEST_CUE_PATTERN);

  if (
    !topicMatch ||
    !cueMatch ||
    topicMatch.index === undefined ||
    cueMatch.index === undefined
  ) {
    return null;
  }

  const start = Math.min(topicMatch.index, cueMatch.index);

  const candidate = text
    .slice(start)
    .replace(/^(?:и|а)\s+/iu, '')
    .trim();

  return candidate || null;
}

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
  const model = aiService.getChatModel('FAST');

  const structuredRouter = model.withStructuredOutput(
    RequestRouterModelSchema,
    {
      name: 'route_support_request',
      includeRaw: true,
    },
  );

  const chain = requestRouterPrompt.pipe(structuredRouter);

  return async (state) => {
    /*
     * Сначала проверяем однозначные запросы
     * на выполнение операции по заказу.
     *
     * Это серверное правило, а не решение LLM.
     */
    const explicitAssistance = inferExplicitOrderAssistance(state.query);

    if (explicitAssistance) {
      const decision = RequestRouterSchema.parse({
        route: 'execute',

        workers: ['orderAgent'],

        workerQueries: {
          productAgent: null,

          orderAgent: state.query,

          customerHelpAgent: null,
        },

        orderRequest: {
          action: explicitAssistance,

          orderId: null,

          orderNumber: extractOrderNumber(state.query),
        },

        clarificationTopic: null,

        handoffRequest: null,

        reason: 'Explicit order operation detected by server.',
      });

      return {
        requestRouter: decision,

        executionMode: 'single' as const,

        clarification: null,

        handoffRequest: null,

        workerResults: [],

        answer: null,
      };
    }

    /*
     * Для остальных запросов сохраняется
     * существующая LLM-маршрутизация.
     */
    const history = await requestRouterHistoryTrimmer.invoke(
      state.messages.slice(0, -1),
    );

    const routerProductContext = state.productWorkspace
      ? state.productWorkspace.tasks.length ||
        state.productWorkspace.pendingClarification
        ? {
            pendingClarification: state.productWorkspace.pendingClarification,

            tasks: state.productWorkspace.tasks.map((task) => ({
              taskId: task.taskId,

              question: task.question,

              context: createRouterProductContext(task.record),
            })),

            focusTaskIds: state.productWorkspace.focus.map(
              (focus) => focus.taskId,
            ),
          }
        : null
      : createRouterProductContext(state.productConsultationRecord);

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

    let reason = modelDecision.reason;

    if (workerQueries.customerHelpAgent === null) {
      const inferredCustomerHelp = inferCustomerHelpWorkerQuery(state.query);

      if (inferredCustomerHelp) {
        workerQueries.customerHelpAgent = inferredCustomerHelp;

        reason = `${reason} Deterministic customer-help recovery.`;
      }
    }

    let orderRequest = modelDecision.orderRequest;

    if (workerQueries.orderAgent !== null && orderRequest === null) {
      orderRequest = {
        action: 'RELEVANT',

        orderId: null,

        orderNumber: null,
      };
    }

    if (workerQueries.orderAgent === null) {
      orderRequest = null;
    }

    let workers = RequestRouterWorkerSchema.options.filter(
      (worker) => workerQueries[worker] !== null,
    );

    if (
      orderRequest &&
      EXCLUSIVE_ORDER_ACTIONS.has(orderRequest.action) &&
      workerQueries.orderAgent !== null
    ) {
      workerQueries.productAgent = null;

      workerQueries.customerHelpAgent = null;

      workers = ['orderAgent'];
    }

    let fallbackRoute = modelDecision.fallbackRoute;

    let clarificationTopic = modelDecision.clarificationTopic;

    let handoffRequest = modelDecision.handoffRequest;

    if (workers.length === 0 && !fallbackRoute) {
      if (routerProductContext !== null) {
        workerQueries.productAgent = state.query;

        workers = ['productAgent'];

        orderRequest = null;

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

    if (workers.length > 0) {
      fallbackRoute = null;

      clarificationTopic = null;

      handoffRequest = null;
    }

    const route =
      workers.length > 0 ? 'execute' : fallbackRoute ?? 'clarification';

    const decision = RequestRouterSchema.parse({
      route,

      workers,

      workerQueries,

      orderRequest,

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
