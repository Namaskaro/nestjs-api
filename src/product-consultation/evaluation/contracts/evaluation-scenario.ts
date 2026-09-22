import { z } from 'zod';

export type EvaluationJsonValue =
  | string
  | number
  | boolean
  | null
  | EvaluationJsonValue[]
  | { [key: string]: EvaluationJsonValue };

export const EvaluationJsonValueSchema: z.ZodType<EvaluationJsonValue> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(EvaluationJsonValueSchema),
      z.record(z.string(), EvaluationJsonValueSchema),
    ]),
);

export const EvaluationTargetSchema = z.enum([
  'product_consultation',
  'support_agent',
]);

export type EvaluationTarget = z.infer<typeof EvaluationTargetSchema>;

const EvaluationTurnIdSchema = z.string().trim().min(1);

export const EvaluationMessageTurnSchema = z.object({
  id: EvaluationTurnIdSchema,

  kind: z.literal('message'),

  message: z.string().trim().min(1),

  /**
   * Нужен для сценариев retry / idempotency.
   *
   * Это infrastructure identity, а не часть Product Consultation semantics.
   */
  messageId: z.string().trim().min(1).nullable().default(null),
});

export const EvaluationResumeTurnSchema = z.object({
  id: EvaluationTurnIdSchema,

  kind: z.literal('resume'),

  /**
   * Значение, которым продолжается interrupted execution.
   *
   * Harness не знает внутреннюю форму этого значения.
   * Target отвечает за его интерпретацию.
   */
  value: EvaluationJsonValueSchema,
});

export const EvaluationScenarioTurnSchema = z.discriminatedUnion('kind', [
  EvaluationMessageTurnSchema,
  EvaluationResumeTurnSchema,
]);

export type EvaluationScenarioTurn = z.infer<
  typeof EvaluationScenarioTurnSchema
>;

export const EvaluationCheckDefinitionSchema = z.object({
  /**
   * Стабильный ID проверки.
   *
   * Например:
   * - no-unnecessary-search
   * - preserves-user-constraint
   * - answer-grounded
   *
   * Реализация проверки живёт в evaluators/,
   * а не внутри scenario contract.
   */
  id: z.string().trim().min(1),

  description: z.string().trim().min(1),

  /**
   * Необязательные параметры конкретной проверки.
   *
   * Контракт намеренно не знает внутреннюю структуру state.
   */
  params: z.record(z.string(), EvaluationJsonValueSchema).default(() => ({})),
});

export type EvaluationCheckDefinition = z.infer<
  typeof EvaluationCheckDefinitionSchema
>;

export const EvaluationScenarioSchema = z.object({
  /**
   * Например E01, E15, E30.
   */
  id: z.string().trim().min(1),

  title: z.string().trim().min(1),

  description: z.string().trim().min(1).nullable().default(null),

  /**
   * Что именно запускаем:
   * Product Consultation напрямую
   * или весь SupportAgent end-to-end.
   */
  target: EvaluationTargetSchema,

  /**
   * Имя фиксированного fixture catalog.
   *
   * Сам каталог хранится в fixtures/.
   */
  fixtureCatalogId: z.string().trim().min(1).nullable().default(null),

  /**
   * Начальное состояние разговора.
   *
   * Harness рассматривает его как opaque JSON snapshot
   * и не знает его внутренней архитектуры.
   */
  initialState: EvaluationJsonValueSchema.nullable().default(null),

  /**
   * Один scenario может быть multi-turn.
   */
  turns: z.array(EvaluationScenarioTurnSchema).min(1),

  /**
   * Какие проверки должны быть выполнены после прогона.
   */
  checks: z.array(EvaluationCheckDefinitionSchema).default(() => []),

  /**
   * Для выборки smoke / regression / search / context и т.д.
   */
  tags: z.array(z.string().trim().min(1)).default(() => []),
});

export type EvaluationScenario = z.infer<typeof EvaluationScenarioSchema>;
