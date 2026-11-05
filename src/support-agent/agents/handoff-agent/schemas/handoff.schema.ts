import { z } from 'zod';

export const HandoffReasonSchema = z.enum([
  'CUSTOMER_REQUEST',
  'UNSUPPORTED_ACTION',
  'ASSISTANT_FAILURE',
]);

export const HandoffTriggerSchema = z.enum([
  'OPERATOR_BUTTON',
  'EXPLICIT_USER_REQUEST',
  'UNSUPPORTED_INTENT',
  'AGENT_ERROR',
  'NEGATIVE_FEEDBACK',
]);

/**
 * Решение маршрутизатора.
 *
 * RequestRouter может определить причину
 * передачи, но не должен самостоятельно
 * создавать проверенные факты о заказах.
 */
export const HandoffRouterRequestSchema = z.object({
  reason: HandoffReasonSchema,
  trigger: HandoffTriggerSchema,
});

export const HandoffRelatedEntitiesSchema = z.object({
  orderIds: z.array(z.string()).default([]),

  // Публичные номера заказов храним отдельно
  // от внутренних идентификаторов.
  orderNumbers: z.array(z.string()).default([]),

  productIds: z.array(z.string()).default([]),
});

export const HandoffEvidenceSourceSchema = z.enum([
  'orderAgent',
  'customerHelpAgent',
  'productAgent',
]);

/**
 * Сведения от специализированного компонента.
 *
 * verifiedFacts и actionsTaken должны
 * заполняться на основании результатов
 * реальных операций системы.
 *
 * userReportedIssue — описание запроса,
 * а не подтверждённый системой факт.
 */
export const HandoffEvidenceSchema = z.object({
  source: HandoffEvidenceSourceSchema,

  userReportedIssue: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .nullable()
    .default(null),

  requestedOutcome: z.string().trim().min(1).max(1000).nullable().default(null),

  verifiedFacts: z.array(z.string().trim().min(1).max(500)).max(20).default([]),

  actionsTaken: z.array(z.string().trim().min(1).max(500)).max(20).default([]),

  unresolvedQuestions: z
    .array(z.string().trim().min(1).max(500))
    .max(10)
    .default([]),

  relatedEntities: HandoffRelatedEntitiesSchema.nullable().default(null),
});

/**
 * Внутренний запрос на передачу.
 *
 * Старые вызовы с reason и trigger
 * остаются совместимыми.
 *
 * evidence необязателен — например,
 * когда покупатель просто просит человека.
 */
export const HandoffRequestSchema = HandoffRouterRequestSchema.extend({
  evidence: HandoffEvidenceSchema.nullable().optional(),
});

/**
 * Итоговый контекст для оператора.
 *
 * Именно этот объект создаётся
 * PrepareHandoffNode.
 */
export const HandoffContextSchema = z.object({
  issue: z.string().describe('Краткое описание проблемы пользователя'),

  userGoal: z.string().describe('Какого результата хочет пользователь'),

  verifiedFacts: z
    .array(z.string())
    .default([])
    .describe('Подтверждённые системой сведения'),

  actionsTaken: z
    .array(z.string())
    .default([])
    .describe('Действия, действительно выполненные системой'),

  unresolvedQuestions: z
    .array(z.string())
    .default([])
    .describe('Что оператору ещё необходимо решить'),

  relatedEntities: HandoffRelatedEntitiesSchema.nullable(),
});

export const HandoffSchema = z.object({
  handoffMessage: z
    .string()
    .default('Передаю ваш запрос оператору')
    .describe('Сообщение о передаче обращения'),

  reason: HandoffReasonSchema,

  trigger: HandoffTriggerSchema,

  context: HandoffContextSchema.nullable(),
});

export type HandoffReason = z.infer<typeof HandoffReasonSchema>;

export type HandoffTrigger = z.infer<typeof HandoffTriggerSchema>;

export type HandoffRouterRequest = z.infer<typeof HandoffRouterRequestSchema>;

export type HandoffEvidence = z.infer<typeof HandoffEvidenceSchema>;

export type HandoffRequest = z.infer<typeof HandoffRequestSchema>;

export type HandoffRelatedEntities = z.infer<
  typeof HandoffRelatedEntitiesSchema
>;

export type HandoffContext = z.infer<typeof HandoffContextSchema>;

export type Handoff = z.infer<typeof HandoffSchema>;
