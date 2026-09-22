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
   * Должен совпадать с check.id в scenario.
   */
  readonly id: string;

  readonly source: EvaluationCheckSource;

  evaluate(
    context: EvaluationCheckContext,
  ): EvaluationCheckResult | Promise<EvaluationCheckResult>;
}
