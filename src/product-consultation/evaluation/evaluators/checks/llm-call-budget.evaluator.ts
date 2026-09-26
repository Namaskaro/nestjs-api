import { z } from 'zod';

import type { EvaluationCheckResult } from '../../contracts/evaluation-result';

import type {
  EvaluationCheckContext,
  EvaluationCheckEvaluator,
} from '../evaluation-evaluator';

const LlmCallBudgetParamsSchema = z
  .object({
    /**
     * Если указан turnId,
     * budget применяется только
     * к конкретному turn.
     *
     * Иначе считаем весь scenario.
     */
    turnId: z.string().trim().min(1).optional(),

    /**
     * Опционально ограничить
     * конкретное логическое имя
     * model call.
     *
     * Например:
     *
     * product_consultant
     */
    name: z.string().trim().min(1).optional(),

    maxCalls: z.number().int().nonnegative().optional(),

    maxInputTokens: z.number().int().nonnegative().optional(),

    maxOutputTokens: z.number().int().nonnegative().optional(),

    maxTotalTokens: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.maxCalls === undefined &&
      value.maxInputTokens === undefined &&
      value.maxOutputTokens === undefined &&
      value.maxTotalTokens === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        message: 'LLM budget requires at least one limit.',
      });
    }
  });

export class LlmCallBudgetEvaluator implements EvaluationCheckEvaluator {
  readonly evaluator = 'llm-call-budget';

  readonly source = 'deterministic' as const;

  evaluate({
    check,
    observation,
  }: EvaluationCheckContext): EvaluationCheckResult {
    const params = LlmCallBudgetParamsSchema.parse(check.params);

    let turns = observation.turns;

    if (params.turnId) {
      const turn = observation.turns.find(
        (item) => item.input.id === params.turnId,
      );

      if (!turn) {
        throw new Error(
          `LlmCallBudgetEvaluator: turn "${params.turnId}" не найден`,
        );
      }

      turns = [turn];
    }

    const allCalls = turns.flatMap((turn) => turn.llmCalls);

    const calls =
      params.name === undefined
        ? allCalls
        : allCalls.filter((call) => call.name === params.name);

    const callCount = calls.length;

    const tokenBudgetConfigured =
      params.maxInputTokens !== undefined ||
      params.maxOutputTokens !== undefined ||
      params.maxTotalTokens !== undefined;

    /**
     * Token budget нельзя
     * проверять через придуманный 0.
     *
     * Если provider не дал usage,
     * такой budget считается
     * непроверенным → fail.
     */
    const callsWithMissingUsage = tokenBudgetConfigured
      ? calls.filter(
          (call) =>
            call.usage.usageMissing ||
            call.usage.inputTokens === null ||
            call.usage.outputTokens === null ||
            call.usage.totalTokens === null,
        )
      : [];

    const inputTokens = calls.reduce(
      (total, call) => total + (call.usage.inputTokens ?? 0),

      0,
    );

    const outputTokens = calls.reduce(
      (total, call) => total + (call.usage.outputTokens ?? 0),

      0,
    );

    const totalTokens = calls.reduce(
      (total, call) => total + (call.usage.totalTokens ?? 0),

      0,
    );

    const violations: string[] = [];

    if (params.maxCalls !== undefined && callCount > params.maxCalls) {
      violations.push(`calls ${callCount} > ${params.maxCalls}`);
    }

    if (tokenBudgetConfigured && callsWithMissingUsage.length > 0) {
      violations.push(
        `token usage missing for ${callsWithMissingUsage.length} call(s)`,
      );
    }

    if (
      params.maxInputTokens !== undefined &&
      inputTokens > params.maxInputTokens
    ) {
      violations.push(`input tokens ${inputTokens} > ${params.maxInputTokens}`);
    }

    if (
      params.maxOutputTokens !== undefined &&
      outputTokens > params.maxOutputTokens
    ) {
      violations.push(
        `output tokens ${outputTokens} > ${params.maxOutputTokens}`,
      );
    }

    if (
      params.maxTotalTokens !== undefined &&
      totalTokens > params.maxTotalTokens
    ) {
      violations.push(`total tokens ${totalTokens} > ${params.maxTotalTokens}`);
    }

    const passed = violations.length === 0;

    return {
      id: check.id,

      source: this.source,

      status: passed ? 'pass' : 'fail',

      message: passed
        ? `LLM budget соблюдён: calls=${callCount}, tokens=${totalTokens}.`
        : `LLM budget нарушен: ${violations.join('; ')}.`,

      details: {
        evaluator: this.evaluator,

        turnId: params.turnId ?? null,

        name: params.name ?? null,

        actual: {
          calls: callCount,

          inputTokens,

          outputTokens,

          totalTokens,

          missingUsageCalls: callsWithMissingUsage.length,
        },

        limits: {
          maxCalls: params.maxCalls ?? null,

          maxInputTokens: params.maxInputTokens ?? null,

          maxOutputTokens: params.maxOutputTokens ?? null,

          maxTotalTokens: params.maxTotalTokens ?? null,
        },
      },
    };
  }
}
