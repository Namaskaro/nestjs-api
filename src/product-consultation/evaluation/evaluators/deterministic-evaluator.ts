import type { EvaluationScenario } from '../contracts/evaluation-scenario';

import type { EvaluationObservation } from '../contracts/evaluation-observation';

import type { EvaluationCheckResult } from '../contracts/evaluation-result';

import type { EvaluationCheckEvaluator } from './evaluation-evaluator';

type DeterministicEvaluatorInput = {
  scenario: EvaluationScenario;

  observation: EvaluationObservation;
};

export class DeterministicEvaluator {
  private readonly evaluators = new Map<string, EvaluationCheckEvaluator>();

  constructor(evaluators: readonly EvaluationCheckEvaluator[] = []) {
    for (const evaluator of evaluators) {
      this.register(evaluator);
    }
  }

  register(evaluator: EvaluationCheckEvaluator): void {
    if (evaluator.source !== 'deterministic') {
      throw new Error(
        `DeterministicEvaluator: evaluator "${evaluator.evaluator}" имеет source="${evaluator.source}"`,
      );
    }

    if (this.evaluators.has(evaluator.evaluator)) {
      throw new Error(
        `DeterministicEvaluator: evaluator "${evaluator.evaluator}" уже зарегистрирован`,
      );
    }

    this.evaluators.set(evaluator.evaluator, evaluator);
  }

  async evaluate({
    scenario,
    observation,
  }: DeterministicEvaluatorInput): Promise<EvaluationCheckResult[]> {
    if (scenario.id !== observation.scenarioId) {
      throw new Error(
        `DeterministicEvaluator: scenario mismatch: ${scenario.id} !== ${observation.scenarioId}`,
      );
    }

    const results: EvaluationCheckResult[] = [];

    for (const check of scenario.checks) {
      const evaluator = this.evaluators.get(check.evaluator);

      /**
       * Здесь evaluator может отсутствовать,
       * если check относится к live_model.
       *
       * Его обработает другой evaluator layer.
       */
      if (!evaluator) {
        continue;
      }

      try {
        const result = await evaluator.evaluate({
          scenario,

          observation,

          check,
        });

        results.push({
          ...result,

          /**
           * Всегда сохраняем ID конкретной
           * проверки из scenario.
           */
          id: check.id,

          source: 'deterministic',
        });
      } catch (error) {
        results.push({
          id: check.id,

          source: 'deterministic',

          status: 'error',

          message: error instanceof Error ? error.message : String(error),

          details: {
            evaluator: check.evaluator,
          },
        });
      }
    }

    return results;
  }
}
