import { z } from 'zod';

import type { EvaluationCheckResult } from '../../contracts/evaluation-result';

import type {
  EvaluationCheckContext,
  EvaluationCheckEvaluator,
} from '../evaluation-evaluator';

const ToolCallCountParamsSchema = z
  .object({
    /**
     * Если name отсутствует,
     * считаются все tool calls.
     */
    name: z.string().trim().min(1).optional(),

    exact: z.number().int().nonnegative().optional(),

    min: z.number().int().nonnegative().optional(),

    max: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, context) => {
    const limits = [value.exact, value.min, value.max].filter(
      (item) => item !== undefined,
    );

    if (limits.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        message: 'Нужно указать exact, min или max.',
      });
    }

    if (
      value.exact !== undefined &&
      (value.min !== undefined || value.max !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        message: 'exact нельзя использовать одновременно с min/max.',
      });
    }

    if (
      value.min !== undefined &&
      value.max !== undefined &&
      value.min > value.max
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        message: 'min не может быть больше max.',
      });
    }
  });

export class ToolCallCountEvaluator implements EvaluationCheckEvaluator {
  readonly evaluator = 'tool-call-count';

  readonly source = 'deterministic' as const;

  evaluate({
    check,
    observation,
  }: EvaluationCheckContext): EvaluationCheckResult {
    const params = ToolCallCountParamsSchema.parse(check.params);

    const calls = observation.turns.flatMap((turn) => turn.toolCalls);

    const matchingCalls =
      params.name === undefined
        ? calls
        : calls.filter((call) => call.name === params.name);

    const count = matchingCalls.length;

    let passed = true;

    if (params.exact !== undefined) {
      passed = count === params.exact;
    }

    if (params.min !== undefined && count < params.min) {
      passed = false;
    }

    if (params.max !== undefined && count > params.max) {
      passed = false;
    }

    return {
      id: check.id,

      source: this.source,

      status: passed ? 'pass' : 'fail',

      message: passed
        ? `Количество tool calls соответствует ожиданию: ${count}.`
        : `Количество tool calls не соответствует ожиданию: ${count}.`,

      details: {
        evaluator: this.evaluator,

        toolName: params.name ?? null,

        actual: count,

        exact: params.exact ?? null,

        min: params.min ?? null,

        max: params.max ?? null,
      },
    };
  }
}
