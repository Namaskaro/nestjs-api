import type { RunnableConfig } from '@langchain/core/runnables';

import type {
  EvaluationArtifact,
  EvaluationTurnOutcome,
} from '../contracts/evaluation-observation';

import type {
  EvaluationJsonValue,
  EvaluationScenarioTurn,
  EvaluationTarget,
} from '../contracts/evaluation-scenario';

export type EvaluationTargetRunInput = {
  turn: EvaluationScenarioTurn;

  /**
   * Harness не знает внутреннюю структуру состояния.
   */
  state: EvaluationJsonValue | null;

  /**
   * Используется для observability.
   *
   * Target не обязан сам что-либо записывать.
   */
  callbacks?: RunnableConfig['callbacks'];
};

export type EvaluationTargetRunResult = {
  stateAfter: EvaluationJsonValue | null;

  outcome: EvaluationTurnOutcome;

  finalText: string | null;

  artifacts: EvaluationArtifact[];

  resultMetadata: EvaluationJsonValue | null;
};

export interface EvaluationTargetAdapter {
  readonly target: EvaluationTarget;

  runTurn(input: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult>;
}
