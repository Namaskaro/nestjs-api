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
   * Нужен для retry / idempotency scenarios.
   *
   * Это infrastructure identity,
   * а не часть Product Consultation semantics.
   */
  messageId: z.string().trim().min(1).nullable().default(null),
});

export const EvaluationResumeTurnSchema = z.object({
  id: EvaluationTurnIdSchema,

  kind: z.literal('resume'),

  /**
   * Значение для продолжения interrupted execution.
   *
   * Harness не знает его внутреннюю структуру.
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
   * Уникальный ID конкретной проверки внутри scenario.
   *
   * Например:
   * - no-extra-search
   * - comparison-artifact-created
   * - no-runtime-errors
   */
  id: z.string().trim().min(1),

  /**
   * Имя evaluator-а, который должен выполнить проверку.
   *
   * Например:
   * - tool-call-count
   * - artifact
   * - no-errors
   */
  evaluator: z.string().trim().min(1),

  description: z.string().trim().min(1),

  /**
   * Параметры evaluator-а.
   *
   * Harness не знает их конкретную форму.
   */
  params: z.record(z.string(), EvaluationJsonValueSchema).default(() => ({})),
});

export type EvaluationCheckDefinition = z.infer<
  typeof EvaluationCheckDefinitionSchema
>;

export const EvaluationScenarioSchema = z
  .object({
    /**
     * Например E01, E15, E30.
     */
    id: z.string().trim().min(1),

    title: z.string().trim().min(1),

    description: z.string().trim().min(1).nullable().default(null),

    /**
     * Что запускаем:
     * Product Consultation напрямую
     * или SupportAgent end-to-end.
     */
    target: EvaluationTargetSchema,

    /**
     * Ссылка на согласованный fixture.
     *
     * Fixture не обязан быть каталогом.
     */
    fixtureId: z.string().trim().min(1).nullable().default(null),

    /**
     * Начальное состояние сценария.
     *
     * Harness воспринимает его как opaque JSON.
     */
    initialState: EvaluationJsonValueSchema.nullable().default(null),

    /**
     * Scenario может быть multi-turn.
     */
    turns: z.array(EvaluationScenarioTurnSchema).min(1),

    /**
     * Проверки, которые должны быть выполнены.
     */
    checks: z.array(EvaluationCheckDefinitionSchema).default(() => []),

    /**
     * Например:
     * baseline, smoke, regression, context, search.
     */
    tags: z.array(z.string().trim().min(1)).default(() => []),
  })
  .superRefine((scenario, context) => {
    const checkIds = new Set<string>();

    for (const check of scenario.checks) {
      if (checkIds.has(check.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ['checks'],

          message: `Evaluation check id "${check.id}" используется несколько раз.`,
        });

        continue;
      }

      checkIds.add(check.id);
    }
  });

export type EvaluationScenario = z.infer<typeof EvaluationScenarioSchema>;
