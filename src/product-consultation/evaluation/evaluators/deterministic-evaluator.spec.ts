import { describe, expect, it } from '@jest/globals';

import {
  EvaluationScenarioSchema,
  type EvaluationScenario,
} from '../contracts/evaluation-scenario';

import {
  EvaluationObservationSchema,
  type EvaluationObservation,
} from '../contracts/evaluation-observation';

import { createDefaultDeterministicEvaluator } from './default-deterministic-evaluators';

function createScenario(): EvaluationScenario {
  return EvaluationScenarioSchema.parse({
    id: 'TEST',

    title: 'Harness unit test',

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

        description: 'No runtime errors.',

        params: {},
      },

      {
        id: 'search-called-once',

        evaluator: 'tool-call-count',

        description: 'Search called once.',

        params: {
          name: 'search_products',

          exact: 1,
        },
      },

      {
        id: 'details-not-called',

        evaluator: 'tool-call-count',

        description: 'Details are not requested.',

        params: {
          name: 'get_product_details',

          exact: 0,
        },
      },

      {
        id: 'one-search-artifact',

        evaluator: 'artifact',

        description: 'One search artifact.',

        params: {
          kind: 'search_results',

          exact: 1,
        },
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

    finishedAt: '2026-09-23T10:00:01.000Z',

    durationMs: 1000,

    initialState: null,

    finalState: null,

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

        finishedAt: '2026-09-23T10:00:01.000Z',

        durationMs: 1000,

        stateBefore: null,

        stateAfter: null,

        outcome: 'answer',

        finalText: 'Done',

        llmCalls: [],

        toolCalls: [
          {
            callId: 'tool-1',

            name: 'search_products',

            args: {
              query: 'test',
            },

            resultMetadata: {
              count: 2,
            },

            durationMs: 50,

            error: null,
          },
        ],

        artifacts: [
          {
            id: null,

            kind: 'search_results',

            data: {
              count: 2,
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

describe('DeterministicEvaluator', () => {
  it('evaluates all registered deterministic checks', async () => {
    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: createScenario(),

      observation: createObservation(),
    });

    expect(results).toHaveLength(4);

    expect(results.map((result) => result.id)).toEqual([
      'no-runtime-errors',
      'search-called-once',
      'details-not-called',
      'one-search-artifact',
    ]);

    expect(results.every((result) => result.status === 'pass')).toBe(true);
  });

  it('supports several checks using the same evaluator', async () => {
    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: createScenario(),

      observation: createObservation(),
    });

    const toolChecks = results.filter(
      (result) =>
        result.id === 'search-called-once' ||
        result.id === 'details-not-called',
    );

    expect(toolChecks).toHaveLength(2);

    expect(toolChecks[0]?.status).toBe('pass');

    expect(toolChecks[1]?.status).toBe('pass');
  });

  it('returns fail when deterministic expectation is violated', async () => {
    const evaluator = createDefaultDeterministicEvaluator();

    const scenario = createScenario();

    const modifiedScenario = EvaluationScenarioSchema.parse({
      ...scenario,

      checks: [
        {
          id: 'search-not-called',

          evaluator: 'tool-call-count',

          description: 'Search must not be called.',

          params: {
            name: 'search_products',

            exact: 0,
          },
        },
      ],
    });

    const results = await evaluator.evaluate({
      scenario: modifiedScenario,

      observation: createObservation(),
    });

    expect(results).toHaveLength(1);

    expect(results[0]?.status).toBe('fail');
  });
});
