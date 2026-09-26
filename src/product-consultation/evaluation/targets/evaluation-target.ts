import type { RunnableConfig } from '@langchain/core/runnables';

import type {
  EvaluationArtifact,
  EvaluationLlmCall,
  EvaluationTurnOutcome,
} from '../contracts/evaluation-observation';

import type {
  EvaluationJsonValue,
  EvaluationScenarioTurn,
  EvaluationTarget,
} from '../contracts/evaluation-scenario';

import type { EvaluationToolCallSink } from '../recording/evaluation-capability-proxy';

export interface EvaluationLlmCallSink {
  recordLlmCall(call: EvaluationLlmCall): void;
}

export type EvaluationTargetRunInput = {
  turn: EvaluationScenarioTurn;

  /**
   * Harness не знает
   * внутреннюю структуру state.
   */
  state: EvaluationJsonValue | null;

  /**
   * Для реального LangChain /
   * LangGraph model adapter.
   *
   * Offline stub может
   * их не использовать.
   */
  callbacks?: RunnableConfig['callbacks'];

  /**
   * Recorder deterministic
   * backend capabilities.
   */
  toolCallSink?: EvaluationToolCallSink;

  /**
   * Recorder model calls.
   *
   * Offline target пишет сюда
   * stub model calls напрямую.
   *
   * Live LangChain target позже
   * сможет использовать callbacks.
   */
  llmCallSink?: EvaluationLlmCallSink;
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
