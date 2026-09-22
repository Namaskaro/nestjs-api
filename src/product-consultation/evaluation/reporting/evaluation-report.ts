import type { EvaluationScenario } from '../contracts/evaluation-scenario';

import type {
  EvaluationObservation,
  EvaluationTokenUsage,
} from '../contracts/evaluation-observation';

import {
  EvaluationResultSchema,
  type EvaluationCheckResult,
  type EvaluationQualityMetrics,
  type EvaluationResult,
} from '../contracts/evaluation-result';

type BuildEvaluationReportInput = {
  scenario: EvaluationScenario;

  observation: EvaluationObservation;

  checks: readonly EvaluationCheckResult[];

  /**
   * Quality metrics заполняются evaluators.
   *
   * Пока evaluator не существует —
   * значение остаётся null.
   */
  quality?: Partial<EvaluationQualityMetrics>;

  /**
   * Стоимость runtime target-а.
   *
   * Подключим позже через отдельный pricing snapshot.
   */
  estimatedCostUsd?: number | null;

  /**
   * Стоимость judge/evaluation моделей отдельно.
   */
  evaluationCostUsd?: number | null;
};

function countByName(names: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};

  for (const name of names) {
    result[name] = (result[name] ?? 0) + 1;
  }

  return result;
}

function sumNullable(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null);

  if (available.length === 0) {
    return null;
  }

  return available.reduce((sum, value) => sum + value, 0);
}

function aggregateTokenUsage(
  observation: EvaluationObservation,
): EvaluationTokenUsage {
  const calls = observation.turns.flatMap((turn) => turn.llmCalls);

  if (calls.length === 0) {
    return {
      inputTokens: 0,

      outputTokens: 0,

      totalTokens: 0,

      cachedInputTokens: 0,

      usageMissing: false,
    };
  }

  return {
    inputTokens: sumNullable(calls.map((call) => call.usage.inputTokens)),

    outputTokens: sumNullable(calls.map((call) => call.usage.outputTokens)),

    totalTokens: sumNullable(calls.map((call) => call.usage.totalTokens)),

    cachedInputTokens: sumNullable(
      calls.map((call) => call.usage.cachedInputTokens),
    ),

    /**
     * true означает:
     * хотя бы по одному LLM-вызову
     * данные usage неполные.
     */
    usageMissing: calls.some((call) => call.usage.usageMissing),
  };
}

function validateCheckResults(
  scenario: EvaluationScenario,

  checks: readonly EvaluationCheckResult[],
): void {
  const expectedIds = new Set(scenario.checks.map((check) => check.id));

  const actualIds = new Set<string>();

  for (const check of checks) {
    if (!expectedIds.has(check.id)) {
      throw new Error(
        `EvaluationReport: неизвестный check "${check.id}" для scenario "${scenario.id}"`,
      );
    }

    if (actualIds.has(check.id)) {
      throw new Error(
        `EvaluationReport: check "${check.id}" оценён несколько раз`,
      );
    }

    actualIds.add(check.id);
  }

  for (const expectedId of expectedIds) {
    if (!actualIds.has(expectedId)) {
      throw new Error(`EvaluationReport: check "${expectedId}" не был оценён`);
    }
  }
}

function resolveStatus(
  observation: EvaluationObservation,

  checks: readonly EvaluationCheckResult[],
): EvaluationResult['status'] {
  const technicalFailure = observation.turns.some(
    (turn) => turn.outcome === 'technical_failure' || turn.errors.length > 0,
  );

  const evaluationError = checks.some(
    (check) => check.status === 'error' || check.status === 'not_evaluated',
  );

  if (technicalFailure || evaluationError) {
    return 'error';
  }

  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }

  return 'pass';
}

export function buildEvaluationReport({
  scenario,
  observation,
  checks,
  quality = {},
  estimatedCostUsd = null,
  evaluationCostUsd = null,
}: BuildEvaluationReportInput): EvaluationResult {
  if (scenario.id !== observation.scenarioId) {
    throw new Error(
      `EvaluationReport: scenario mismatch: ${scenario.id} !== ${observation.scenarioId}`,
    );
  }

  validateCheckResults(scenario, checks);

  const llmCalls = observation.turns.flatMap((turn) => turn.llmCalls);

  const toolCalls = observation.turns.flatMap((turn) => turn.toolCalls);

  const artifacts = observation.turns.flatMap((turn) => turn.artifacts);

  const fallbackCount = observation.turns.reduce(
    (total, turn) => total + turn.fallbacks.length,
    0,
  );

  const errorCount = observation.turns.reduce(
    (total, turn) => total + turn.errors.length,
    0,
  );

  return EvaluationResultSchema.parse({
    scenarioId: scenario.id,

    status: resolveStatus(observation, checks),

    checks,

    quality: {
      taskSuccess: quality.taskSuccess ?? null,

      groundedness: quality.groundedness ?? null,

      contextRetention: quality.contextRetention ?? null,

      contextPollution: quality.contextPollution ?? null,

      unnecessarySearch: quality.unnecessarySearch ?? null,

      unnecessaryQuestions: quality.unnecessaryQuestions ?? null,
    },

    execution: {
      llmCalls: {
        total: llmCalls.length,

        byName: countByName(llmCalls.map((call) => call.name)),
      },

      toolCalls: {
        total: toolCalls.length,

        byName: countByName(toolCalls.map((call) => call.name)),
      },

      artifacts: {
        total: artifacts.length,

        byKind: countByName(artifacts.map((artifact) => artifact.kind)),
      },

      tokens: aggregateTokenUsage(observation),

      latencyMs: observation.durationMs,

      fallbackCount,

      errorCount,

      estimatedCostUsd,

      evaluationCostUsd,
    },

    observation,
  });
}
