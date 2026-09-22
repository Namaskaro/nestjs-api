import { describe, expect, it } from '@jest/globals';

import {
  EvaluationScenarioSchema,
  type EvaluationScenario,
} from '../contracts/evaluation-scenario';

import {
  EvaluationObservationSchema,
  type EvaluationObservation,
} from '../contracts/evaluation-observation';

import type { EvaluationCheckResult } from '../contracts/evaluation-result';

import { buildEvaluationReport } from './evaluation-report';

function createScenario(): EvaluationScenario {
  return EvaluationScenarioSchema.parse({
    id: 'TEST',

    title: 'Report unit test',

    description: null,

    target: 'product_consultation',

    fixtureId: null,

    initialState: null,

    turns: [
      {
        id: 'T1',

        kind: 'message',

        message: 'Test',

        messageId: null,
      },
    ],

    checks: [
      {
        id: 'no-runtime-errors',

        evaluator: 'no-errors',

        description: 'No errors.',

        params: {},
      },
    ],

    tags: ['unit-test'],
  });
}

function createObservation(): EvaluationObservation {
  return EvaluationObservationSchema.parse({
    scenarioId: 'TEST',

    target: 'product_consultation',

    startedAt: '2026-09-23T10:00:00.000Z',

    finishedAt: '2026-09-23T10:00:02.000Z',

    durationMs: 2000,

    initialState: null,

    finalState: {
      finished: true,
    },

    turns: [
      {
        turnIndex: 0,

        input: {
          id: 'T1',

          kind: 'message',

          message: 'Test',

          messageId: null,
        },

        startedAt: '2026-09-23T10:00:00.000Z',

        finishedAt: '2026-09-23T10:00:02.000Z',

        durationMs: 2000,

        stateBefore: null,

        stateAfter: {
          finished: true,
        },

        outcome: 'answer',

        finalText: 'Done',

        llmCalls: [
          {
            callId: 'llm-1',

            name: 'planner',

            provider: 'test',

            model: 'model-a',

            durationMs: 500,

            usage: {
              inputTokens: 100,

              outputTokens: 25,

              totalTokens: 125,

              cachedInputTokens: 10,

              usageMissing: false,
            },

            error: null,
          },

          {
            callId: 'llm-2',

            name: 'consultant',

            provider: 'test',

            model: 'model-a',

            durationMs: 600,

            usage: {
              inputTokens: 50,

              outputTokens: 15,

              totalTokens: 65,

              cachedInputTokens: 0,

              usageMissing: false,
            },

            error: null,
          },
        ],

        toolCalls: [
          {
            callId: 'tool-1',

            name: 'search_products',

            args: null,

            resultMetadata: {
              count: 3,
            },

            durationMs: 100,

            error: null,
          },
        ],

        artifacts: [
          {
            id: null,

            kind: 'search_results',

            data: {
              count: 3,
            },
          },
        ],

        fallbacks: [],

        errors: [],

        resultMetadata: null,
      },
    ],
  });
}

function createPassingChecks(): EvaluationCheckResult[] {
  return [
    {
      id: 'no-runtime-errors',

      source: 'deterministic',

      status: 'pass',

      message: 'No errors.',

      details: {
        errorCount: 0,
      },
    },
  ];
}

describe('buildEvaluationReport', () => {
  it('aggregates execution metrics', () => {
    const report = buildEvaluationReport({
      scenario: createScenario(),

      observation: createObservation(),

      checks: createPassingChecks(),
    });

    expect(report.status).toBe('pass');

    expect(report.execution.llmCalls.total).toBe(2);

    expect(report.execution.llmCalls.byName).toEqual({
      planner: 1,

      consultant: 1,
    });

    expect(report.execution.toolCalls.total).toBe(1);

    expect(report.execution.toolCalls.byName).toEqual({
      search_products: 1,
    });

    expect(report.execution.artifacts.total).toBe(1);

    expect(report.execution.artifacts.byKind).toEqual({
      search_results: 1,
    });

    expect(report.execution.tokens).toEqual({
      inputTokens: 150,

      outputTokens: 40,

      totalTokens: 190,

      cachedInputTokens: 10,

      usageMissing: false,
    });

    expect(report.execution.latencyMs).toBe(2000);

    expect(report.execution.errorCount).toBe(0);

    expect(report.execution.fallbackCount).toBe(0);
  });

  it('returns fail when a check fails', () => {
    const report = buildEvaluationReport({
      scenario: createScenario(),

      observation: createObservation(),

      checks: [
        {
          id: 'no-runtime-errors',

          source: 'deterministic',

          status: 'fail',

          message: 'Check failed.',

          details: null,
        },
      ],
    });

    expect(report.status).toBe('fail');
  });

  it('returns error when execution has a technical error', () => {
    const observation = createObservation();

    const brokenObservation = EvaluationObservationSchema.parse({
      ...observation,

      turns: observation.turns.map((turn) => ({
        ...turn,

        outcome: 'technical_failure',

        errors: [
          {
            source: 'product_consultation',

            message: 'Runtime failure',

            code: null,
          },
        ],
      })),
    });

    const report = buildEvaluationReport({
      scenario: createScenario(),

      observation: brokenObservation,

      checks: createPassingChecks(),
    });

    expect(report.status).toBe('error');

    expect(report.execution.errorCount).toBe(1);
  });
});
