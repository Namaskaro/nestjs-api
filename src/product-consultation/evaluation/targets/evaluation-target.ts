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

import type { EvaluationToolCallSink } from '../recording/evaluation-capability-proxy';

export type EvaluationTargetRunInput = {
  turn: EvaluationScenarioTurn;

  /**
   * Harness не знает внутреннюю структуру state.
   */
  state: EvaluationJsonValue | null;

  /**
   * LangChain / LangGraph callbacks.
   */
  callbacks?: RunnableConfig['callbacks'];

  /**
   * Recorder обычных deterministic capabilities.
   *
   * Target сам решает,
   * какие свои вызовы считать capability calls.
   */
  toolCallSink?: EvaluationToolCallSink;
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
