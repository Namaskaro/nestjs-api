import { z } from 'zod';

import {
  EvaluationObservationSchema,
  EvaluationTokenUsageSchema,
} from './evaluation-observation';

export const EvaluationCheckSourceSchema = z.enum([
  'deterministic',
  'live_model',
]);

export type EvaluationCheckSource = z.infer<typeof EvaluationCheckSourceSchema>;

export const EvaluationCheckStatusSchema = z.enum([
  'pass',
  'fail',
  'not_evaluated',
  'error',
]);

export type EvaluationCheckStatus = z.infer<typeof EvaluationCheckStatusSchema>;

export const EvaluationCheckResultSchema = z.object({
  /**
   * ID конкретной проверки из scenario.
   */
  id: z.string().trim().min(1),

  source: EvaluationCheckSourceSchema,

  status: EvaluationCheckStatusSchema,

  message: z.string().trim().min(1).nullable().default(null),

  details: z.record(z.string(), z.unknown()).nullable().default(null),
});

export type EvaluationCheckResult = z.infer<typeof EvaluationCheckResultSchema>;

export const EvaluationQualityMetricsSchema = z.object({
  taskSuccess: z.boolean().nullable(),

  /**
   * 0..1.
   *
   * null = ещё не оценено.
   */
  groundedness: z.number().min(0).max(1).nullable(),

  contextRetention: z.boolean().nullable(),

  /**
   * true = обнаружено загрязнение контекста.
   */
  contextPollution: z.boolean().nullable(),

  /**
   * true = был выполнен ненужный поиск.
   */
  unnecessarySearch: z.boolean().nullable(),

  /**
   * Количество подтверждённых лишних вопросов.
   */
  unnecessaryQuestions: z.number().int().nonnegative().nullable(),
});

export type EvaluationQualityMetrics = z.infer<
  typeof EvaluationQualityMetricsSchema
>;

export const EvaluationExecutionMetricsSchema = z.object({
  llmCalls: z.object({
    total: z.number().int().nonnegative(),

    byName: z.record(z.string(), z.number().int().nonnegative()),
  }),

  toolCalls: z.object({
    total: z.number().int().nonnegative(),

    byName: z.record(z.string(), z.number().int().nonnegative()),
  }),

  artifacts: z.object({
    total: z.number().int().nonnegative(),

    byKind: z.record(z.string(), z.number().int().nonnegative()),
  }),

  tokens: EvaluationTokenUsageSchema,

  latencyMs: z.number().nonnegative(),

  fallbackCount: z.number().int().nonnegative(),

  errorCount: z.number().int().nonnegative(),

  /**
   * Стоимость runtime тестируемой системы.
   */
  estimatedCostUsd: z.number().nonnegative().nullable(),

  /**
   * Стоимость evaluation/judge моделей отдельно.
   */
  evaluationCostUsd: z.number().nonnegative().nullable(),
});

export type EvaluationExecutionMetrics = z.infer<
  typeof EvaluationExecutionMetricsSchema
>;

export const EvaluationResultStatusSchema = z.enum(['pass', 'fail', 'error']);

export type EvaluationResultStatus = z.infer<
  typeof EvaluationResultStatusSchema
>;

export const EvaluationResultSchema = z.object({
  scenarioId: z.string().trim().min(1),

  status: EvaluationResultStatusSchema,

  checks: z.array(EvaluationCheckResultSchema),

  quality: EvaluationQualityMetricsSchema,

  execution: EvaluationExecutionMetricsSchema,

  /**
   * Полный factual record прогона.
   */
  observation: EvaluationObservationSchema,
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
