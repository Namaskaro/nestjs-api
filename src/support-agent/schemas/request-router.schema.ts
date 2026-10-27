import { z } from 'zod';

import { HandoffRequestSchema } from '../agents/handoff-agent/schemas/handoff.schema';

import { ClarificationTopicSchema } from './clarification-topic.schema';

import { OrderRequestSchema } from './order-request.schema';

export const RequestRouterWorkerSchema = z
  .enum(['productAgent', 'orderAgent', 'customerHelpAgent'])
  .describe(
    [
      'productAgent — поиск, подбор, сравнение, детали, рекомендации и продолжение товарной консультации.',
      'orderAgent — информация о заказах пользователя, статус заказа, отслеживание отправлений, последний или актуальный заказ, отмена заказа.',
      'customerHelpAgent — доставка, оплата, возврат, обмен, скидки, лояльность и правила магазина.',
    ].join(' '),
  );

export const RequestRouterWorkerQueriesSchema = z.object({
  productAgent: z
    .string()
    .min(1)
    .nullable()
    .describe(
      [
        'Товарная часть текущей реплики пользователя.',
        'Передавай максимально близко к исходной формулировке.',
        'Не восстанавливай сохранённые параметры товарной консультации.',
        'ProductAgent получает authoritative consultation state отдельно.',
        'Заполни для поиска, изменения поиска, сравнения, деталей, рекомендации или товарного follow-up.',
        'Иначе верни null.',
      ].join(' '),
    ),

  orderAgent: z
    .string()
    .min(1)
    .nullable()
    .describe(
      [
        'Запрос пользователя, относящийся к его конкретным заказам.',
        'Используй для списка заказов, статуса заказа, отслеживания отправления, последнего заказа, актуального заказа или отмены.',
        'Сохраняй явно указанный номер заказа без изменений.',
        'Не используй для общих правил доставки, оплаты или возврата.',
        'Иначе верни null.',
      ].join(' '),
    ),

  customerHelpAgent: z
    .string()
    .min(1)
    .nullable()
    .describe(
      [
        'Самодостаточный запрос для customerHelpAgent.',
        'Заполни для общих правил доставки, оплаты, возврата, обмена, скидок, лояльности или правил магазина.',
        'Можно добавить только явно известные релевантные факты из истории.',
        'Иначе верни null.',
      ].join(' '),
    ),
});

export const RequestRouterFallbackRouteSchema = z.enum([
  'unsupported',
  'clarification',
  'handoff',
]);

export const RequestRouterModelSchema = z.object({
  workerQueries: RequestRouterWorkerQueriesSchema,

  // Strict model output requires every key; legacy internal requests stay optional.
  orderRequest: OrderRequestSchema.required({ orderNumber: true }).nullable().describe(
    [
      'Заполняй только если workerQueries.orderAgent не null.',
      'LIST — список или история заказов.',
      'GET — показать конкретный заказ без более точной операции.',
      'LATEST — показать последний заказ.',
      'RELEVANT — показать актуальный заказ.',
      'STATUS — узнать состояние или стадию выполнения заказа.',
      'TRACKING — узнать местоположение посылки, трек-номер, перевозчика, прогноз доставки или движение отправления.',
      'CANCEL — пользователь действительно хочет отменить заказ.',
      'Для STATUS и TRACKING можно указывать orderNumber или orderId.',
      'Если конкретный заказ не указан, оба идентификатора null.',
      'Публичный номер, например №10482, передавай в orderNumber как строку "10482".',
      'Внутренний технический идентификатор передавай в orderId.',
      'Не путай orderId и orderNumber и не придумывай значения.',
      'Если пользователь спрашивает, где сейчас посылка, выбирай TRACKING, а не STATUS.',
      'Если спрашивает только стадию обработки заказа, выбирай STATUS.',
    ].join(' '),
  ),

  fallbackRoute: RequestRouterFallbackRouteSchema.nullable().describe(
    [
      'Используется только если все workerQueries равны null.',
      'clarification — задача магазина непонятна и не может быть передана domain agent.',
      'handoff — требуется оператор.',
      'unsupported — запрос не относится к магазину.',
      'Если хотя бы один workerQuery заполнен, верни null.',
    ].join(' '),
  ),

  clarificationTopic: ClarificationTopicSchema.nullable().describe(
    [
      'Заполняй только для fallbackRoute = clarification, если тему можно определить.',
      'Иначе верни null.',
    ].join(' '),
  ),

  handoffRequest: HandoffRequestSchema.nullable().describe(
    ['Заполняй только для fallbackRoute = handoff.', 'Иначе верни null.'].join(
      ' ',
    ),
  ),

  reason: z.string().describe('Кратко объясни принятое решение.'),
});

export const RequestRouterSchema = z.object({
  route: z.enum(['execute', 'unsupported', 'clarification', 'handoff']),

  workers: z
    .array(RequestRouterWorkerSchema)
    .max(RequestRouterWorkerSchema.options.length),

  workerQueries: RequestRouterWorkerQueriesSchema,

  orderRequest: OrderRequestSchema.nullable(),

  clarificationTopic: ClarificationTopicSchema.nullable(),

  handoffRequest: HandoffRequestSchema.nullable(),

  reason: z.string(),
});

export type RequestRouterWorker = z.infer<typeof RequestRouterWorkerSchema>;

export type RequestRouterModelDecision = z.infer<
  typeof RequestRouterModelSchema
>;

export type RequestRouterDecision = z.infer<typeof RequestRouterSchema>;
