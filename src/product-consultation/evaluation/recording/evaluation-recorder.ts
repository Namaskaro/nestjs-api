import {
  EvaluationArtifactSchema,
  EvaluationErrorSchema,
  EvaluationFallbackSchema,
  EvaluationLlmCallSchema,
  EvaluationObservationSchema,
  EvaluationToolCallSchema,
  type EvaluationArtifact,
  type EvaluationError,
  type EvaluationFallback,
  type EvaluationLlmCall,
  type EvaluationObservation,
  type EvaluationToolCall,
  type EvaluationTurnObservation,
  type EvaluationTurnOutcome,
} from '../contracts/evaluation-observation';

import {
  EvaluationJsonValueSchema,
  EvaluationScenarioTurnSchema,
  type EvaluationJsonValue,
  type EvaluationScenarioTurn,
  type EvaluationTarget,
} from '../contracts/evaluation-scenario';

type EvaluationClock = () => Date;

type EvaluationRecorderInput = {
  scenarioId: string;

  target: EvaluationTarget;

  initialState: EvaluationJsonValue | null;

  /**
   * Обычно используется обычный new Date().
   *
   * Возможность передать clock нужна только для deterministic tests
   * самого recorder-а.
   */
  clock?: EvaluationClock;
};

type FinishTurnInput = {
  stateAfter: EvaluationJsonValue | null;

  outcome: EvaluationTurnOutcome;

  finalText?: string | null;

  resultMetadata?: EvaluationJsonValue | null;
};

type ActiveTurn = {
  turnIndex: number;

  input: EvaluationScenarioTurn;

  startedAt: Date;

  stateBefore: EvaluationJsonValue | null;

  llmCalls: EvaluationLlmCall[];

  toolCalls: EvaluationToolCall[];

  artifacts: EvaluationArtifact[];

  fallbacks: EvaluationFallback[];

  errors: EvaluationError[];
};

function snapshotJson(
  value: EvaluationJsonValue | null,
): EvaluationJsonValue | null {
  if (value === null) {
    return null;
  }

  /**
   * Валидация одновременно гарантирует,
   * что recorder получает только JSON-safe snapshot.
   *
   * Recorder не знает смысл или внутреннюю структуру state.
   */
  return EvaluationJsonValueSchema.parse(value);
}

export class EvaluationRecorder {
  private readonly scenarioId: string;

  private readonly target: EvaluationTarget;

  private readonly clock: EvaluationClock;

  private readonly startedAt: Date;

  private readonly initialState: EvaluationJsonValue | null;

  private readonly turns: EvaluationTurnObservation[] = [];

  private activeTurn: ActiveTurn | null = null;

  constructor({
    scenarioId,
    target,
    initialState,
    clock = () => new Date(),
  }: EvaluationRecorderInput) {
    this.scenarioId = scenarioId.trim();

    if (!this.scenarioId) {
      throw new Error('EvaluationRecorder: scenarioId не должен быть пустым');
    }

    this.target = target;

    this.clock = clock;

    this.startedAt = this.clock();

    this.initialState = snapshotJson(initialState);
  }

  beginTurn(
    input: EvaluationScenarioTurn,
    stateBefore: EvaluationJsonValue | null,
  ): void {
    if (this.activeTurn) {
      throw new Error(
        `EvaluationRecorder: turn ${this.activeTurn.turnIndex} ещё не завершён`,
      );
    }

    const parsedInput = EvaluationScenarioTurnSchema.parse(input);

    this.activeTurn = {
      turnIndex: this.turns.length,

      input: parsedInput,

      startedAt: this.clock(),

      stateBefore: snapshotJson(stateBefore),

      llmCalls: [],

      toolCalls: [],

      artifacts: [],

      fallbacks: [],

      errors: [],
    };
  }

  recordLlmCall(call: EvaluationLlmCall): void {
    const turn = this.requireActiveTurn();

    turn.llmCalls.push(EvaluationLlmCallSchema.parse(call));
  }

  recordToolCall(call: EvaluationToolCall): void {
    const turn = this.requireActiveTurn();

    turn.toolCalls.push(EvaluationToolCallSchema.parse(call));
  }

  recordArtifact(artifact: EvaluationArtifact): void {
    const turn = this.requireActiveTurn();

    turn.artifacts.push(EvaluationArtifactSchema.parse(artifact));
  }

  recordFallback(fallback: EvaluationFallback): void {
    const turn = this.requireActiveTurn();

    turn.fallbacks.push(EvaluationFallbackSchema.parse(fallback));
  }

  recordError(error: EvaluationError): void {
    const turn = this.requireActiveTurn();

    turn.errors.push(EvaluationErrorSchema.parse(error));
  }

  finishTurn({
    stateAfter,
    outcome,
    finalText = null,
    resultMetadata = null,
  }: FinishTurnInput): EvaluationTurnObservation {
    const turn = this.requireActiveTurn();

    const finishedAt = this.clock();

    const observation: EvaluationTurnObservation = {
      turnIndex: turn.turnIndex,

      input: turn.input,

      startedAt: turn.startedAt.toISOString(),

      finishedAt: finishedAt.toISOString(),

      durationMs: Math.max(0, finishedAt.getTime() - turn.startedAt.getTime()),

      stateBefore: turn.stateBefore,

      stateAfter: snapshotJson(stateAfter),

      outcome,

      finalText,

      llmCalls: [...turn.llmCalls],

      toolCalls: [...turn.toolCalls],

      artifacts: [...turn.artifacts],

      fallbacks: [...turn.fallbacks],

      errors: [...turn.errors],

      resultMetadata: snapshotJson(resultMetadata),
    };

    this.turns.push(observation);

    this.activeTurn = null;

    return observation;
  }

  finish(finalState: EvaluationJsonValue | null): EvaluationObservation {
    if (this.activeTurn) {
      throw new Error(
        `EvaluationRecorder: нельзя завершить scenario, пока turn ${this.activeTurn.turnIndex} активен`,
      );
    }

    if (this.turns.length === 0) {
      throw new Error(
        'EvaluationRecorder: scenario не содержит завершённых turns',
      );
    }

    const finishedAt = this.clock();

    return EvaluationObservationSchema.parse({
      scenarioId: this.scenarioId,

      target: this.target,

      startedAt: this.startedAt.toISOString(),

      finishedAt: finishedAt.toISOString(),

      durationMs: Math.max(0, finishedAt.getTime() - this.startedAt.getTime()),

      initialState: this.initialState,

      finalState: snapshotJson(finalState),

      turns: this.turns,
    });
  }

  private requireActiveTurn(): ActiveTurn {
    if (!this.activeTurn) {
      throw new Error(
        'EvaluationRecorder: операция требует активный evaluation turn',
      );
    }

    return this.activeTurn;
  }
}
