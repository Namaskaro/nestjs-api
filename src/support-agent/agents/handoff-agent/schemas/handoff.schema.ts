import z from 'zod';

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

export const HandoffRequestSchema = z.object({
  reason: HandoffReasonSchema,
  trigger: HandoffTriggerSchema,
});

export const HandoffRelatedEntitiesSchema = z.object({
  orderIds: z.array(z.string()).default([]),
  productIds: z.array(z.string()).default([]),
});

export const HandoffContextSchema = z.object({
  issue: z.string().describe('Краткое описание проблемы пользователя'),

  userGoal: z.string().describe('Какого результата хочет пользователь'),

  verifiedFacts: z
    .array(z.string())
    .default([])
    .describe('Факты, которые бот уже проверил и подтвердил'),

  actionsTaken: z
    .array(z.string())
    .default([])
    .describe('Действия, уже выполненные ботом'),

  unresolvedQuestions: z
    .array(z.string())
    .default([])
    .describe('Вопросы, которые остались нерешёнными'),

  relatedEntities: HandoffRelatedEntitiesSchema.nullable(),
});

export const HandoffSchema = z.object({
  handoffMessage: z
    .string()
    .default('Передаю ваш запрос оператору')
    .describe('Сообщение с которым ассистент передает клиента оператору'),
  reason: HandoffReasonSchema.describe('Укажи причину перевода на оператора'),
  trigger: HandoffTriggerSchema.describe(
    'Событие которое вызвало перевод на оператора',
  ),
  context: HandoffContextSchema.nullable().describe(
    'Перед передачей клиента оператору собирается контекст последних сообщений, чтобы оператор сразу понимал что нужно клиенту. Тут мы ожидаем какая проблема у пользователя, на кокой она стадии решений, какого результата хочет пользователь, даннгые помогающие решить запрос клиента(например номер заказа или id товара)',
  ),
});

export type HandoffReason = z.infer<typeof HandoffReasonSchema>;
export type HandoffTrigger = z.infer<typeof HandoffTriggerSchema>;
export type HandoffRequest = z.infer<typeof HandoffRequestSchema>;
export type HandoffRelatedEntities = z.infer<
  typeof HandoffRelatedEntitiesSchema
>;
export type HandoffContext = z.infer<typeof HandoffContextSchema>;
export type Handoff = z.infer<typeof HandoffSchema>;
