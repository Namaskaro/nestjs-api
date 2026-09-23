import { describe, expect, it } from '@jest/globals';

import {
  EvaluationScenarioSchema,
  type EvaluationScenario,
} from '../../contracts/evaluation-scenario';

import {
  EvaluationObservationSchema,
  type EvaluationObservation,
} from '../../contracts/evaluation-observation';

import { createDefaultDeterministicEvaluator } from '../default-deterministic-evaluators';

function createScenario(): EvaluationScenario {
  return EvaluationScenarioSchema.parse({
    id: 'JSON-VALUE-TEST',

    title: 'JSON value evaluator test',

    description: null,

    target: 'product_consultation',

    fixtureId: null,

    initialState: null,

    turns: [
      {
        id: 'T1',

        kind: 'message',

        message: 'Search',

        messageId: null,
      },

      {
        id: 'T2',

        kind: 'message',

        message: 'Complete',

        messageId: null,
      },
    ],

    checks: [
      {
        id: 'zero-results',

        evaluator: 'json-value',

        description: 'Search returned zero products.',

        params: {
          turnId: 'T1',

          source: 'result_metadata',

          path: 'returnedProducts',

          equals: 0,
        },
      },

      {
        id: 'search-brand',

        evaluator: 'json-value',

        description: 'Search contains expected brand.',

        params: {
          turnId: 'T1',

          source: 'tool_call',

          toolName: 'search_products',

          path: 'constraints.brand',

          equals: 'Adidas',
        },
      },

      {
        id: 'search-color-present',

        evaluator: 'json-value',

        description: 'Search preserves color constraint.',

        params: {
          turnId: 'T1',

          source: 'tool_call',

          toolName: 'search_products',

          path: 'constraints.color',

          notNull: true,
        },
      },

      {
        id: 'feedback-options',

        evaluator: 'json-value',

        description: 'Completion contains feedback options.',

        params: {
          turnId: 'T2',

          source: 'artifact',

          artifactKind: 'consultation_completion',

          path: 'feedbackRequest.options',

          equals: ['HELPFUL', 'NOT_HELPFUL'],
        },
      },
    ],

    tags: ['unit-test'],
  });
}

function createObservation(): EvaluationObservation {
  return EvaluationObservationSchema.parse({
    scenarioId: 'JSON-VALUE-TEST',

    target: 'product_consultation',

    startedAt: '2026-09-23T10:00:00.000Z',

    finishedAt: '2026-09-23T10:00:02.000Z',

    durationMs: 2000,

    initialState: null,

    finalState: null,

    turns: [
      {
        turnIndex: 0,

        input: {
          id: 'T1',

          kind: 'message',

          message: 'Search',

          messageId: null,
        },

        startedAt: '2026-09-23T10:00:00.000Z',

        finishedAt: '2026-09-23T10:00:01.000Z',

        durationMs: 1000,

        stateBefore: null,

        stateAfter: null,

        outcome: 'answer',

        finalText: 'Nothing found',

        llmCalls: [],

        toolCalls: [
          {
            callId: 'search-1',

            name: 'search_products',

            args: {
              query: 'мужские кроссовки',

              constraints: {
                gender: 'MAN',

                type: 'SHOES',

                brand: 'Adidas',

                category: null,

                subcategory: 'кроссовки',

                color: 'зелёный',

                size: null,

                minPrice: null,

                maxPrice: null,
              },
            },

            resultMetadata: {
              count: 0,
            },

            durationMs: 50,

            error: null,
          },
        ],

        artifacts: [],

        fallbacks: [],

        errors: [],

        resultMetadata: {
          returnedProducts: 0,
        },
      },

      {
        turnIndex: 1,

        input: {
          id: 'T2',

          kind: 'message',

          message: 'Complete',

          messageId: null,
        },

        startedAt: '2026-09-23T10:00:01.000Z',

        finishedAt: '2026-09-23T10:00:02.000Z',

        durationMs: 1000,

        stateBefore: null,

        stateAfter: null,

        outcome: 'answer',

        finalText: 'Was the consultation helpful?',

        llmCalls: [],

        toolCalls: [],

        artifacts: [
          {
            id: 'session-1',

            kind: 'consultation_completion',

            data: {
              sessionId: 'session-1',

              status: 'COMPLETED',

              reason: 'PRODUCT_SELECTED',

              selectedProductIds: ['product-1'],

              feedbackRequest: {
                kind: 'HELPFULNESS',

                options: ['HELPFUL', 'NOT_HELPFUL'],
              },

              feedback: null,
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

describe('JsonValueEvaluator', () => {
  it('checks result metadata, tool call args and artifacts', async () => {
    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: createScenario(),

      observation: createObservation(),
    });

    expect(results).toHaveLength(4);

    expect(results.every((result) => result.status === 'pass')).toBe(true);
  });

  it('fails when tool-call value does not match', async () => {
    const scenario = createScenario();

    const changedScenario = EvaluationScenarioSchema.parse({
      ...scenario,

      checks: [
        {
          id: 'wrong-brand',

          evaluator: 'json-value',

          description: 'Wrong expected brand.',

          params: {
            turnId: 'T1',

            source: 'tool_call',

            toolName: 'search_products',

            path: 'constraints.brand',

            equals: 'Nike',
          },
        },
      ],
    });

    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: changedScenario,

      observation: createObservation(),
    });

    expect(results[0]?.status).toBe('fail');
  });

  it('checks that value is not null', async () => {
    const scenario = createScenario();

    const changedScenario = EvaluationScenarioSchema.parse({
      ...scenario,

      checks: [
        {
          id: 'color-present',

          evaluator: 'json-value',

          description: 'Color must be preserved.',

          params: {
            turnId: 'T1',

            source: 'tool_call',

            toolName: 'search_products',

            path: 'constraints.color',

            notNull: true,
          },
        },
      ],
    });

    const evaluator = createDefaultDeterministicEvaluator();

    const results = await evaluator.evaluate({
      scenario: changedScenario,

      observation: createObservation(),
    });

    expect(results[0]?.status).toBe('pass');
  });
});
