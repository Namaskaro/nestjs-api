import { z } from 'zod';

import type { EvaluationCheckResult } from '../../contracts/evaluation-result';

import type {
  EvaluationCheckContext,
  EvaluationCheckEvaluator,
} from '../evaluation-evaluator';

const ArtifactParamsSchema = z
  .object({
    kind: z.string().trim().min(1),

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

export class ArtifactEvaluator implements EvaluationCheckEvaluator {
  readonly id = 'artifact';

  readonly source = 'deterministic' as const;

  evaluate({
    check,
    observation,
  }: EvaluationCheckContext): EvaluationCheckResult {
    const params = ArtifactParamsSchema.parse(check.params);

    const artifacts = observation.turns
      .flatMap((turn) => turn.artifacts)
      .filter((artifact) => artifact.kind === params.kind);

    const count = artifacts.length;

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
        ? `Artifact "${params.kind}" соответствует ожиданию: ${count}.`
        : `Artifact "${params.kind}" не соответствует ожиданию: ${count}.`,

      details: {
        kind: params.kind,

        actual: count,

        exact: params.exact ?? null,

        min: params.min ?? null,

        max: params.max ?? null,
      },
    };
  }
}
