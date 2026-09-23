import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import {
  EvaluationJsonValueSchema,
  type EvaluationJsonValue,
} from '../../contracts/evaluation-scenario';

import type { EvaluationCheckResult } from '../../contracts/evaluation-result';

import type {
  EvaluationCheckContext,
  EvaluationCheckEvaluator,
} from '../evaluation-evaluator';

const JsonValueParamsSchema = z
  .object({
    turnId: z.string().trim().min(1),

    source: z.enum(['result_metadata', 'artifact', 'tool_call']),

    artifactKind: z.string().trim().min(1).optional(),

    artifactIndex: z.number().int().nonnegative().default(0),

    toolName: z.string().trim().min(1).optional(),

    toolCallIndex: z.number().int().nonnegative().default(0),

    path: z.string().trim().min(1),

    equals: EvaluationJsonValueSchema.optional(),

    notNull: z.literal(true).optional(),
  })
  .superRefine((value, context) => {
    if (value.source === 'artifact' && !value.artifactKind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['artifactKind'],
        message: 'artifactKind обязателен для source="artifact".',
      });
    }

    if (value.source === 'tool_call' && !value.toolName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toolName'],
        message: 'toolName обязателен для source="tool_call".',
      });
    }

    const expectations = [
      value.equals !== undefined,
      value.notNull === true,
    ].filter(Boolean);

    if (expectations.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Нужно указать ровно одно ожидание: equals или notNull.',
      });
    }
  });

type ReadPathResult =
  | {
      found: true;
      value: EvaluationJsonValue;
    }
  | {
      found: false;
      value: null;
    };

function readJsonPath(root: EvaluationJsonValue, path: string): ReadPathResult {
  const segments = path.split('.');

  let current: EvaluationJsonValue = root;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);

      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return {
          found: false,
          value: null,
        };
      }

      current = current[index];

      continue;
    }

    if (current !== null && typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return {
          found: false,
          value: null,
        };
      }

      current = current[segment];

      continue;
    }

    return {
      found: false,
      value: null,
    };
  }

  return {
    found: true,
    value: current,
  };
}

export class JsonValueEvaluator implements EvaluationCheckEvaluator {
  readonly evaluator = 'json-value';

  readonly source = 'deterministic' as const;

  evaluate({
    check,
    observation,
  }: EvaluationCheckContext): EvaluationCheckResult {
    const params = JsonValueParamsSchema.parse(check.params);

    const turn = observation.turns.find(
      (item) => item.input.id === params.turnId,
    );

    if (!turn) {
      throw new Error(`JsonValueEvaluator: turn "${params.turnId}" не найден`);
    }

    let root: EvaluationJsonValue | null = null;

    if (params.source === 'result_metadata') {
      root = turn.resultMetadata;
    }

    if (params.source === 'artifact') {
      const artifacts = turn.artifacts.filter(
        (artifact) => artifact.kind === params.artifactKind,
      );

      const artifact = artifacts[params.artifactIndex];

      if (!artifact) {
        return this.missingSource(
          check.id,
          params,
          `Artifact "${params.artifactKind}" не найден в turn "${params.turnId}".`,
        );
      }

      root = artifact.data;
    }

    if (params.source === 'tool_call') {
      const toolCalls = turn.toolCalls.filter(
        (call) => call.name === params.toolName,
      );

      const toolCall = toolCalls[params.toolCallIndex];

      if (!toolCall) {
        return this.missingSource(
          check.id,
          params,
          `Tool call "${params.toolName}" не найден в turn "${params.turnId}".`,
        );
      }

      root = toolCall.args;
    }

    if (root === null) {
      return this.missingSource(
        check.id,
        params,
        `Источник "${params.source}" отсутствует в turn "${params.turnId}".`,
      );
    }

    const actual = readJsonPath(root, params.path);

    let passed = false;

    if (actual.found) {
      if (params.equals !== undefined) {
        passed = isDeepStrictEqual(actual.value, params.equals);
      }

      if (params.notNull === true) {
        passed = actual.value !== null;
      }
    }

    return {
      id: check.id,

      source: this.source,

      status: passed ? 'pass' : 'fail',

      message: passed
        ? `Значение "${params.path}" соответствует ожиданию.`
        : `Значение "${params.path}" не соответствует ожиданию.`,

      details: {
        evaluator: this.evaluator,

        turnId: params.turnId,

        source: params.source,

        artifactKind: params.artifactKind ?? null,

        toolName: params.toolName ?? null,

        path: params.path,

        found: actual.found,

        expected:
          params.equals !== undefined
            ? params.equals
            : {
                notNull: true,
              },

        actual: actual.found ? actual.value : null,
      },
    };
  }

  private missingSource(
    checkId: string,
    params: z.infer<typeof JsonValueParamsSchema>,
    message: string,
  ): EvaluationCheckResult {
    return {
      id: checkId,

      source: this.source,

      status: 'fail',

      message,

      details: {
        evaluator: this.evaluator,

        turnId: params.turnId,

        source: params.source,

        artifactKind: params.artifactKind ?? null,

        toolName: params.toolName ?? null,

        path: params.path,

        found: false,

        expected:
          params.equals !== undefined
            ? params.equals
            : {
                notNull: true,
              },

        actual: null,
      },
    };
  }
}
