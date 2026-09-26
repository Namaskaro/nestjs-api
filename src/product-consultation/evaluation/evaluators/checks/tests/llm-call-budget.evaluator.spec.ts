import { describe, expect, it } from '@jest/globals';
import { EvaluationScenarioSchema } from '../../../contracts/evaluation-scenario';
import { EvaluationObservationSchema } from '../../../contracts/evaluation-observation';
import { LlmCallBudgetEvaluator } from '../llm-call-budget.evaluator';

function scenario(params: Record<string, unknown>) {
  return EvaluationScenarioSchema.parse({
    id: 'LLM-BUDGET',

    title: 'LLM budget',

    description: null,

    target: 'product_consultation',

    fixtureId: null,

    initialState: null,

    turns: [
      {
        id: 'T1',

        kind: 'message',

        message: 'Найди Nike',

        messageId: 'm1',
      },
    ],

    checks: [
      {
        id: 'budget',

        evaluator: 'llm-call-budget',

        description:
          'Product Consultant must stay inside call and token budget.',

        params,
      },
    ],

    tags: ['budget'],
  });
}

function llmCall(input: {
  callId: string;

  inputTokens: number | null;

  outputTokens: number | null;

  totalTokens: number | null;

  usageMissing?: boolean;
}) {
  return {
    callId: input.callId,

    name: 'product_consultant',

    provider: 'test-provider',

    model: 'test-model',

    durationMs: 100,

    usage: {
      inputTokens: input.inputTokens,

      outputTokens: input.outputTokens,

      totalTokens: input.totalTokens,

      cachedInputTokens: 0,

      usageMissing: input.usageMissing ?? false,
    },

    error: null,
  };
}

function observation(calls: ReturnType<typeof llmCall>[]) {
  return EvaluationObservationSchema.parse({
    scenarioId: 'LLM-BUDGET',

    target: 'product_consultation',

    startedAt: '2026-09-26T00:00:00.000Z',

    finishedAt: '2026-09-26T00:00:01.000Z',

    durationMs: 1000,

    initialState: null,

    finalState: null,

    turns: [
      {
        turnIndex: 0,

        input: {
          id: 'T1',

          kind: 'message',

          message: 'Найди Nike',

          messageId: 'm1',
        },

        startedAt: '2026-09-26T00:00:00.000Z',

        finishedAt: '2026-09-26T00:00:01.000Z',

        durationMs: 1000,

        stateBefore: null,

        stateAfter: null,

        outcome: 'answer',

        finalText: 'Готово',

        llmCalls: calls,

        toolCalls: [],

        artifacts: [],

        fallbacks: [],

        errors: [],

        resultMetadata: null,
      },
    ],
  });
}

describe('LlmCallBudgetEvaluator', () => {
  it('passes when Product Consultant stays inside call and token budget', () => {
    const currentScenario = scenario({
      turnId: 'T1',

      name: 'product_consultant',

      maxCalls: 2,

      maxTotalTokens: 4000,
    });

    const currentObservation = observation([
      llmCall({
        callId: 'llm-1',

        inputTokens: 1200,

        outputTokens: 200,

        totalTokens: 1400,
      }),

      llmCall({
        callId: 'llm-2',

        inputTokens: 1000,

        outputTokens: 180,

        totalTokens: 1180,
      }),
    ]);

    const result = new LlmCallBudgetEvaluator().evaluate({
      scenario: currentScenario,

      observation: currentObservation,

      check: currentScenario.checks[0]!,
    });

    expect(result.status).toBe('pass');

    expect(result.details).toEqual(
      expect.objectContaining({
        actual: expect.objectContaining({
          calls: 2,

          totalTokens: 2580,

          missingUsageCalls: 0,
        }),
      }),
    );
  });

  it('fails when model call count exceeds the turn budget', () => {
    const currentScenario = scenario({
      turnId: 'T1',

      maxCalls: 2,
    });

    const currentObservation = observation([
      llmCall({
        callId: 'llm-1',

        inputTokens: 100,

        outputTokens: 10,

        totalTokens: 110,
      }),

      llmCall({
        callId: 'llm-2',

        inputTokens: 100,

        outputTokens: 10,

        totalTokens: 110,
      }),

      llmCall({
        callId: 'llm-3',

        inputTokens: 100,

        outputTokens: 10,

        totalTokens: 110,
      }),
    ]);

    const result = new LlmCallBudgetEvaluator().evaluate({
      scenario: currentScenario,

      observation: currentObservation,

      check: currentScenario.checks[0]!,
    });

    expect(result.status).toBe('fail');

    expect(result.message).toContain('calls 3 > 2');
  });

  it('fails token budget when provider usage is missing instead of treating it as zero', () => {
    const currentScenario = scenario({
      turnId: 'T1',

      maxCalls: 2,

      maxTotalTokens: 4000,
    });

    const currentObservation = observation([
      llmCall({
        callId: 'llm-1',

        inputTokens: null,

        outputTokens: null,

        totalTokens: null,

        usageMissing: true,
      }),
    ]);

    const result = new LlmCallBudgetEvaluator().evaluate({
      scenario: currentScenario,

      observation: currentObservation,

      check: currentScenario.checks[0]!,
    });

    expect(result.status).toBe('fail');

    expect(result.message).toContain('token usage missing');

    expect(result.details).toEqual(
      expect.objectContaining({
        actual: expect.objectContaining({
          missingUsageCalls: 1,
        }),
      }),
    );
  });

  it('can check only call count when token usage is unavailable', () => {
    const currentScenario = scenario({
      turnId: 'T1',

      maxCalls: 1,
    });

    const currentObservation = observation([
      llmCall({
        callId: 'llm-1',

        inputTokens: null,

        outputTokens: null,

        totalTokens: null,

        usageMissing: true,
      }),
    ]);

    const result = new LlmCallBudgetEvaluator().evaluate({
      scenario: currentScenario,

      observation: currentObservation,

      check: currentScenario.checks[0]!,
    });

    expect(result.status).toBe('pass');
  });

  it('rejects an unknown turn id as evaluator configuration error', () => {
    const currentScenario = scenario({
      turnId: 'UNKNOWN',

      maxCalls: 2,
    });

    expect(() =>
      new LlmCallBudgetEvaluator().evaluate({
        scenario: currentScenario,

        observation: observation([]),

        check: currentScenario.checks[0]!,
      }),
    ).toThrow('turn "UNKNOWN" не найден');
  });
});
