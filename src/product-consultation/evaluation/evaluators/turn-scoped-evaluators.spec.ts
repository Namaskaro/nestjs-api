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
    id: 'MULTI-TURN-TEST',

    title: 'Turn scoped evaluator test',

    description: null,

    target: 'product_consultation',

    fixtureId: null,

    initialState: null,

    turns: [
      {
        id: 'T1',

        kind: 'message',

        message: 'Search products',

        messageId: null,
      },

      {
        id: 'T2',

        kind: 'message',

        message: 'Compare first and third',

        messageId: null,
      },

      {
        id: 'T3',

        kind: 'message',

        message: 'Show first product details',

        messageId: null,
      },
    ],

    checks: [
      {
        id: 'search-on-first-turn',

        evaluator: 'tool-call-count',

        description: 'Search is called on the first turn.',

        params: {
          turnId: 'T1',

          name: 'search_products',

          exact: 1,
        },
      },

      {
        id: 'no-search-on-compare',

        evaluator: 'tool-call-count',

        description: 'Comparison does not trigger a new search.',

        params: {
          turnId: 'T2',

          name: 'search_products',

          exact: 0,
        },
      },

      {
        id: 'comparison-artifact',

        evaluator: 'artifact',

        description: 'Comparison turn produces a comparison artifact.',

        params: {
          turnId: 'T2',

          kind: 'comparison',

          exact: 1,
        },
      },

      {
        id: 'details-read-on-details-turn',

        evaluator: 'tool-call-count',

        description: 'Details turn reads product details.',

        params: {
          turnId: 'T3',

          name: 'get_product_details',

          min: 1,
        },
      },

      {
        id: 'no-search-on-details',

        evaluator: 'tool-call-count',

        description: 'Details turn does not trigger product search.',

        params: {
          turnId: 'T3',

          name: 'search_products',

          exact: 0,
        },
      },

      {
        id: 'details-artifact',

        evaluator: 'artifact',

        description: 'Details turn produces a product details artifact.',

        params: {
          turnId: 'T3',

          kind: 'product_details',

          exact: 1,
        },
      },
    ],

    tags: ['unit-test', 'multi-turn'],
  });
}

function createObservation(): EvaluationObservation {
  return EvaluationObservationSchema.parse({
    scenarioId: 'MULTI-TURN-TEST',

    target: 'product_consultation',

    startedAt: '2026-09-23T10:00:00.000Z',

    finishedAt: '2026-09-23T10:00:03.000Z',

    durationMs: 3000,

    initialState: null,

    finalState: null,

    turns: [
      {
        turnIndex: 0,

        input: {
          id: 'T1',

          kind: 'message',

          message: 'Search products',

          messageId: null,
        },

        startedAt: '2026-09-23T10:00:00.000Z',

        finishedAt: '2026-09-23T10:00:01.000Z',

        durationMs: 1000,

        stateBefore: null,

        stateAfter: null,

        outcome: 'answer',

        finalText: 'Search result',

        llmCalls: [],

        toolCalls: [
          {
            callId: 'search-1',

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

      {
        turnIndex: 1,

        input: {
          id: 'T2',

          kind: 'message',

          message: 'Compare first and third',

          messageId: null,
        },

        startedAt: '2026-09-23T10:00:01.000Z',

        finishedAt: '2026-09-23T10:00:02.000Z',

        durationMs: 1000,

        stateBefore: null,

        stateAfter: null,

        outcome: 'answer',

        finalText: 'Comparison result',

        llmCalls: [],

        toolCalls: [],

        artifacts: [
          {
            id: null,

            kind: 'comparison',

            data: {
              products: ['product-1', 'product-3'],
            },
          },
        ],

        fallbacks: [],

        errors: [],

        resultMetadata: null,
      },

      {
        turnIndex: 2,

        input: {
          id: 'T3',

          kind: 'message',

          message: 'Show first product details',

          messageId: null,
        },

        startedAt: '2026-09-23T10:00:02.000Z',

        finishedAt: '2026-09-23T10:00:03.000Z',

        durationMs: 1000,

        stateBefore: null,

        stateAfter: null,

        outcome: 'answer',

        finalText: 'Product details',

        llmCalls: [],

        toolCalls: [
          {
            callId: 'details-1',

            name: 'get_product_details',

            args: ['product-1'],

            resultMetadata: {
              count: 1,
            },

            durationMs: 50,

            error: null,
          },
        ],

        artifacts: [
          {
            id: null,

            kind: 'product_details',

            data: {
              productId: 'product-1',
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

describe('turn scoped evaluators', () => {
  it('evaluates tool calls and artifacts inside a specific turn', async () => {
    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: createScenario(),

      observation: createObservation(),
    });

    expect(results).toHaveLength(6);

    expect(results.every((result) => result.status === 'pass')).toBe(true);
  });

  it('fails only the affected turn check', async () => {
    const observation = createObservation();

    const modified = EvaluationObservationSchema.parse({
      ...observation,

      turns: observation.turns.map((turn) => {
        if (turn.input.id !== 'T2') {
          return turn;
        }

        return {
          ...turn,

          toolCalls: [
            {
              callId: 'unexpected-search',

              name: 'search_products',

              args: null,

              resultMetadata: null,

              durationMs: 100,

              error: null,
            },
          ],
        };
      }),
    });

    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: createScenario(),

      observation: modified,
    });

    const failed = results.find(
      (result) => result.id === 'no-search-on-compare',
    );

    expect(failed?.status).toBe('fail');

    expect(
      results.find((result) => result.id === 'search-on-first-turn')?.status,
    ).toBe('pass');

    expect(
      results.find((result) => result.id === 'no-search-on-details')?.status,
    ).toBe('pass');
  });

  it('returns evaluation error when configured turn does not exist', async () => {
    const scenario = createScenario();

    const brokenScenario = EvaluationScenarioSchema.parse({
      ...scenario,

      checks: [
        {
          id: 'unknown-turn',

          evaluator: 'tool-call-count',

          description: 'Unknown turn must be reported as configuration error.',

          params: {
            turnId: 'UNKNOWN',

            name: 'search_products',

            exact: 0,
          },
        },
      ],
    });

    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: brokenScenario,

      observation: createObservation(),
    });

    expect(results).toHaveLength(1);

    expect(results[0]?.status).toBe('error');
  });
});
