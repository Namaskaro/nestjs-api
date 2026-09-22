import {
  EvaluationScenarioSchema,
  type EvaluationJsonValue,
  type EvaluationScenario,
} from './contracts/evaluation-scenario';

import type { EvaluationObservation } from './contracts/evaluation-observation';

import type { EvaluationResult } from './contracts/evaluation-result';

import { EvaluationRecorder } from './recording/evaluation-recorder';

import { createLangChainEvalCallback } from './recording/langchain-eval-callback';

import { createDefaultDeterministicEvaluator } from './evaluators/default-deterministic-evaluators';

import { buildEvaluationReport } from './reporting/evaluation-report';

import type { EvaluationTargetAdapter } from './targets/evaluation-target';

type RunEvaluationScenarioInput = {
  scenario: EvaluationScenario;

  target: EvaluationTargetAdapter;

  initialState?: EvaluationJsonValue | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Низкоуровневый запуск.
 *
 * Только выполняет scenario и записывает факты.
 * Ничего не оценивает.
 */
export async function recordEvaluationScenario({
  scenario: rawScenario,
  target,
  initialState: initialStateOverride,
}: RunEvaluationScenarioInput): Promise<EvaluationObservation> {
  const scenario = EvaluationScenarioSchema.parse(rawScenario);

  if (scenario.target !== target.target) {
    throw new Error(
      `Evaluation target mismatch: scenario=${scenario.target}, target=${target.target}`,
    );
  }

  const initialState =
    initialStateOverride !== undefined
      ? initialStateOverride
      : scenario.initialState;

  const recorder = new EvaluationRecorder({
    scenarioId: scenario.id,

    target: scenario.target,

    initialState,
  });

  let currentState = initialState;

  for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex += 1) {
    const turn = scenario.turns[turnIndex];

    recorder.beginTurn(turn, currentState);

    const callback = createLangChainEvalCallback(recorder);

    try {
      const result = await target.runTurn({
        turn,

        state: currentState,

        callbacks: [callback],

        toolCallSink: recorder,
      });

      for (const artifact of result.artifacts) {
        recorder.recordArtifact(artifact);
      }

      recorder.finishTurn({
        stateAfter: result.stateAfter,

        outcome: result.outcome,

        finalText: result.finalText,

        resultMetadata: result.resultMetadata,
      });

      currentState = result.stateAfter;

      if (result.outcome === 'technical_failure') {
        break;
      }
    } catch (error) {
      recorder.recordError({
        source: target.target,

        message: errorMessage(error),

        code: null,
      });

      recorder.finishTurn({
        stateAfter: currentState,

        outcome: 'technical_failure',

        finalText: null,

        resultMetadata: null,
      });

      break;
    }
  }

  return recorder.finish(currentState);
}

/**
 * Полный deterministic evaluation:
 *
 * scenario
 * → target
 * → observation
 * → deterministic evaluators
 * → report
 */
export async function runDeterministicEvaluationScenario({
  scenario: rawScenario,
  target,
  initialState,
}: RunEvaluationScenarioInput): Promise<EvaluationResult> {
  const scenario = EvaluationScenarioSchema.parse(rawScenario);

  const observation = await recordEvaluationScenario({
    scenario,

    target,

    initialState,
  });

  const evaluator = createDefaultDeterministicEvaluator();

  const checks = await evaluator.evaluate({
    scenario,

    observation,
  });

  return buildEvaluationReport({
    scenario,

    observation,

    checks,
  });
}
