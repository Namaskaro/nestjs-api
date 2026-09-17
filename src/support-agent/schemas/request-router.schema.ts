// START CHANGES — DOMAIN QUERY CONTRACTS

import { z } from 'zod';

import { HandoffRequestSchema } from '../agents/handoff-agent/schemas/handoff.schema';

import { ClarificationTopicSchema } from './clarification-topic.schema';

export const RequestRouterWorkerSchema = z
  .enum(['productAgent', 'customerHelpAgent'])
  .describe(
    [
      'productAgent — поиск, подбор, сравнение, рекомендации и продолжение товарной консультации.',
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
        'Передавай её максимально близко к исходной формулировке.',
        'Не восстанавливай старые filters из ProductContext: ProductAgent получает ProductContext отдельно.',
        'Заполни для поиска, подбора, сравнения, рекомендаций, изменения текущего подбора или ответа на товарный clarification.',
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
        'Заполни для доставки, оплаты, возврата, обмена, скидок, лояльности или правил магазина.',
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

  fallbackRoute: RequestRouterFallbackRouteSchema.nullable().describe(
    [
      'Используется только если оба workerQueries равны null.',
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

  clarificationTopic: ClarificationTopicSchema.nullable(),

  handoffRequest: HandoffRequestSchema.nullable(),

  reason: z.string(),
});

export type RequestRouterWorker = z.infer<typeof RequestRouterWorkerSchema>;

export type RequestRouterModelDecision = z.infer<
  typeof RequestRouterModelSchema
>;

export type RequestRouterDecision = z.infer<typeof RequestRouterSchema>;
