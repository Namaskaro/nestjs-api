import { z } from 'zod';

import {
  EvaluationJsonValueSchema,
  EvaluationScenarioTurnSchema,
  EvaluationTargetSchema,
} from './evaluation-scenario';

export const EvaluationTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),

  outputTokens: z.number().int().nonnegative().nullable(),

  totalTokens: z.number().int().nonnegative().nullable(),

  cachedInputTokens: z.number().int().nonnegative().nullable(),

  /**
   * true, если provider не вернул usable token usage.
   *
   * Никаких придуманных значений вместо отсутствующих данных.
   */
  usageMissing: z.boolean(),
});

export type EvaluationTokenUsage = z.infer<typeof EvaluationTokenUsageSchema>;

export const EvaluationLlmCallSchema = z.object({
  /**
   * Необязательный runtime/run ID.
   */
  callId: z.string().trim().min(1).nullable().default(null),

  /**
   * Логическое имя вызова.
   *
   * Например request_router или product_consultant.
   * Harness не требует конкретных имён.
   */
  name: z.string().trim().min(1),

  provider: z.string().trim().min(1).nullable(),

  model: z.string().trim().min(1).nullable(),

  durationMs: z.number().nonnegative(),

  usage: EvaluationTokenUsageSchema,

  error: z.string().nullable().default(null),
});

export type EvaluationLlmCall = z.infer<typeof EvaluationLlmCallSchema>;

export const EvaluationToolCallSchema = z.object({
  callId: z.string().trim().min(1).nullable().default(null),

  /**
   * Семантическое имя capability/tool.
   *
   * Например search_products / get_product_facts.
   */
  name: z.string().trim().min(1),

  args: EvaluationJsonValueSchema,

  /**
   * Не весь raw result.
   *
   * Только полезная для evaluation метаинформация.
   */
  resultMetadata: EvaluationJsonValueSchema.nullable().default(null),

  durationMs: z.number().nonnegative(),

  error: z.string().nullable().default(null),
});

export type EvaluationToolCall = z.infer<typeof EvaluationToolCallSchema>;

export const EvaluationArtifactSchema = z.object({
  id: z.string().trim().min(1).nullable().default(null),

  kind: z.string().trim().min(1),

  data: EvaluationJsonValueSchema.nullable().default(null),
});

export type EvaluationArtifact = z.infer<typeof EvaluationArtifactSchema>;

export const EvaluationFallbackSchema = z.object({
  source: z.string().trim().min(1),

  reason: z.string().trim().min(1),
});

export type EvaluationFallback = z.infer<typeof EvaluationFallbackSchema>;

export const EvaluationErrorSchema = z.object({
  source: z.string().trim().min(1),

  message: z.string().trim().min(1),

  code: z.string().trim().min(1).nullable().default(null),
});

export type EvaluationError = z.infer<typeof EvaluationErrorSchema>;

export const EvaluationTurnOutcomeSchema = z.enum([
  'answer',
  'interrupt',
  'partial',
  'technical_failure',
]);

export type EvaluationTurnOutcome = z.infer<typeof EvaluationTurnOutcomeSchema>;

export const EvaluationTurnObservationSchema = z.object({
  turnIndex: z.number().int().nonnegative(),

  input: EvaluationScenarioTurnSchema,

  startedAt: z.string().datetime(),

  finishedAt: z.string().datetime(),

  durationMs: z.number().nonnegative(),

  stateBefore: EvaluationJsonValueSchema.nullable(),

  stateAfter: EvaluationJsonValueSchema.nullable(),

  outcome: EvaluationTurnOutcomeSchema,

  finalText: z.string().nullable(),

  llmCalls: z.array(EvaluationLlmCallSchema).default(() => []),

  toolCalls: z.array(EvaluationToolCallSchema).default(() => []),

  artifacts: z.array(EvaluationArtifactSchema).default(() => []),

  fallbacks: z.array(EvaluationFallbackSchema).default(() => []),

  errors: z.array(EvaluationErrorSchema).default(() => []),

  /**
   * Дополнительные данные target-а, которые могут понадобиться evaluator-у.
   *
   * Harness не интерпретирует их самостоятельно.
   */
  resultMetadata: EvaluationJsonValueSchema.nullable().default(null),
});

export type EvaluationTurnObservation = z.infer<
  typeof EvaluationTurnObservationSchema
>;

export const EvaluationObservationSchema = z.object({
  scenarioId: z.string().trim().min(1),

  target: EvaluationTargetSchema,

  startedAt: z.string().datetime(),

  finishedAt: z.string().datetime(),

  durationMs: z.number().nonnegative(),

  initialState: EvaluationJsonValueSchema.nullable(),

  finalState: EvaluationJsonValueSchema.nullable(),

  turns: z.array(EvaluationTurnObservationSchema).min(1),
});

export type EvaluationObservation = z.infer<typeof EvaluationObservationSchema>;
