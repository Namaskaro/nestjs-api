import { describe, expect, it } from '@jest/globals';

import {
  EvaluationScenarioSchema,
  type EvaluationScenario,
} from './contracts/evaluation-scenario';

import type {
  EvaluationTargetAdapter,
  EvaluationTargetRunInput,
  EvaluationTargetRunResult,
} from './targets/evaluation-target';

import {
  recordEvaluationScenario,
  runDeterministicEvaluationScenario,
} from './run-evaluations';

class FakeEvaluationTarget implements EvaluationTargetAdapter {
  readonly target = 'product_consultation' as const;

  async runTurn({
    turn,
    state,
    toolCallSink,
  }: EvaluationTargetRunInput): Promise<EvaluationTargetRunResult> {
    if (turn.kind !== 'message') {
      throw new Error('Fake target supports only message turns');
    }

    toolCallSink?.recordToolCall({
      callId: 'fake-tool-1',

      name: 'test_capability',

      args: {
        message: turn.message,
      },

      resultMetadata: {
        ok: true,
      },

      durationMs: 10,

      error: null,
    });

    return {
      stateAfter: {
        previousState: state,

        handled: true,
      },

      outcome: 'answer',

      finalText: 'Test answer',

      artifacts: [
        {
          id: null,

          kind: 'test_artifact',

          data: {
            ok: true,
          },
        },
      ],

      resultMetadata: {
        target: 'fake',
      },
    };
  }
}

function createScenario(expectedToolCalls = 1): EvaluationScenario {
  return EvaluationScenarioSchema.parse({
    id: 'HARNESS-TEST',

    title: 'Evaluation harness integration test',

    description: null,

    target: 'product_consultation',

    fixtureId: null,

    initialState: {
      started: true,
    },

    turns: [
      {
        id: 'T1',

        kind: 'message',

        message: 'Test message',

        messageId: null,
      },
    ],

    checks: [
      {
        id: 'no-errors',

        evaluator: 'no-errors',

        description: 'Execution has no errors.',

        params: {},
      },

      {
        id: 'capability-count',

        evaluator: 'tool-call-count',

        description: 'Capability call count is correct.',

        params: {
          name: 'test_capability',

          exact: expectedToolCalls,
        },
      },

      {
        id: 'artifact-created',

        evaluator: 'artifact',

        description: 'Expected artifact exists.',

        params: {
          kind: 'test_artifact',

          exact: 1,
        },
      },
    ],

    tags: ['unit-test'],
  });
}

describe('evaluation runner', () => {
  it('records scenario observation', async () => {
    const observation = await recordEvaluationScenario({
      scenario: createScenario(),

      target: new FakeEvaluationTarget(),
    });

    expect(observation.turns).toHaveLength(1);

    expect(observation.turns[0]?.toolCalls).toHaveLength(1);

    expect(observation.turns[0]?.artifacts).toHaveLength(1);

    expect(observation.turns[0]?.finalText).toBe('Test answer');
  });

  it('returns pass when deterministic checks succeed', async () => {
    const result = await runDeterministicEvaluationScenario({
      scenario: createScenario(),

      target: new FakeEvaluationTarget(),
    });

    expect(result.status).toBe('pass');

    expect(result.checks).toHaveLength(3);

    expect(result.checks.every((check) => check.status === 'pass')).toBe(true);

    expect(result.execution.toolCalls.total).toBe(1);

    expect(result.execution.artifacts.total).toBe(1);

    expect(result.execution.errorCount).toBe(0);
  });

  it('returns fail when deterministic expectation is violated', async () => {
    const result = await runDeterministicEvaluationScenario({
      scenario: createScenario(0),

      target: new FakeEvaluationTarget(),
    });

    expect(result.status).toBe('fail');

    const failedCheck = result.checks.find(
      (check) => check.id === 'capability-count',
    );

    expect(failedCheck?.status).toBe('fail');
  });
});
