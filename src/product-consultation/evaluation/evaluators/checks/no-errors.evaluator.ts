import type { EvaluationCheckResult } from '../../contracts/evaluation-result';

import type {
  EvaluationCheckContext,
  EvaluationCheckEvaluator,
} from '../evaluation-evaluator';

export class NoErrorsEvaluator implements EvaluationCheckEvaluator {
  readonly id = 'no-errors';

  readonly source = 'deterministic' as const;

  evaluate({
    check,
    observation,
  }: EvaluationCheckContext): EvaluationCheckResult {
    const errors = observation.turns.flatMap((turn) => turn.errors);

    if (errors.length === 0) {
      return {
        id: check.id,

        source: this.source,

        status: 'pass',

        message: 'Технических ошибок нет.',

        details: {
          errorCount: 0,
        },
      };
    }

    return {
      id: check.id,

      source: this.source,

      status: 'fail',

      message: `Обнаружено технических ошибок: ${errors.length}.`,

      details: {
        errorCount: errors.length,

        errors,
      },
    };
  }
}
