import type {
  EvaluationCheckDefinition,
  EvaluationScenario,
} from '../contracts/evaluation-scenario';

import type { EvaluationObservation } from '../contracts/evaluation-observation';

import type {
  EvaluationCheckResult,
  EvaluationCheckSource,
} from '../contracts/evaluation-result';

export type EvaluationCheckContext = {
  scenario: EvaluationScenario;

  observation: EvaluationObservation;

  check: EvaluationCheckDefinition;
};

export interface EvaluationCheckEvaluator {
  /**
   * Имя типа evaluator-а.
   *
   * Должно совпадать с check.evaluator.
   *
   * Например:
   * tool-call-count
   * artifact
   * no-errors
   */
  readonly evaluator: string;

  readonly source: EvaluationCheckSource;

  evaluate(
    context: EvaluationCheckContext,
  ): EvaluationCheckResult | Promise<EvaluationCheckResult>;
}
