import { describe, expect, it } from '@jest/globals';

import { resolve } from 'node:path';

import { ConsultationApplicationRecordSchema } from '../../../application/runtime/consultation-application-record';

import { EvaluationScenarioSchema } from '../../contracts/evaluation-scenario';

import { loadCurrentProductConsultationFixture } from '../../fixtures/current-product-consultation.fixture';

import {
  recordEvaluationScenario,
  runDeterministicEvaluationScenario,
} from '../../run-evaluations';

import { OfflineProductConsultantLoopTarget } from '../offline-product-consultant-loop.target';

const fixturePath = resolve(
  process.cwd(),

  'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
);

const scenario = EvaluationScenarioSchema.parse({
  id: 'OFFLINE-CONSULTANT-LOOP',

  title: 'Product Consultant Loop through Evaluation Harness',

  description:
    'Runs the real bounded ProductConsultantLoop with offline model decisions.',

  target: 'product_consultation',

  fixtureId: 'e01-current-catalog',

  initialState: null,

  turns: [
    {
      id: 'T1',

      kind: 'message',

      message: 'Найди мужские кроссовки Nike',

      messageId: 'consultant-loop-t1',
    },
  ],

  checks: [
    {
      id: 'llm-budget',

      evaluator: 'llm-call-budget',

      description: 'Search turn uses at most two Product Consultant calls.',

      params: {
        turnId: 'T1',

        name: 'product_consultant',

        maxCalls: 2,
      },
    },

    {
      id: 'one-search',

      evaluator: 'tool-call-count',

      description: 'Search turn performs exactly one product search.',

      params: {
        turnId: 'T1',

        name: 'search_products',

        exact: 1,
      },
    },

    {
      id: 'search-artifact',

      evaluator: 'artifact',

      description: 'Search produces one search result artifact.',

      params: {
        turnId: 'T1',

        kind: 'search_results',

        exact: 1,
      },
    },

    {
      id: 'no-errors',

      evaluator: 'no-errors',

      description: 'Loop completes without evaluation errors.',

      params: {},
    },
  ],

  tags: ['offline', 'consultant-loop', 'budget', 'search'],
});

const decisions = {
  T1: [
    {
      proposal: {
        action: 'SEARCH',

        taskTransition: 'start_new',

        search: {
          semanticIntent: 'мужские кроссовки Nike',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'gender',

              operator: 'eq',

              value: 'MAN',

              unit: null,
            },

            {
              attributeId: 'type',

              operator: 'eq',

              value: 'SHOES',

              unit: null,
            },

            {
              attributeId: 'brand',

              operator: 'eq',

              value: 'Nike',

              unit: null,
            },
          ],
        },

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      usageScenarioIds: ['daily_walking'],

      terminalText: null,
    },

    {
      proposal: {
        action: 'COMPLETE',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      usageScenarioIds: [],

      terminalText: 'Нашёл три мужские модели Nike.',
    },
  ],
} as const;

describe('OfflineProductConsultantLoopTarget', () => {
  it('records real loop model calls, search capability and artifact in the existing Harness', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const target = new OfflineProductConsultantLoopTarget(
      fixture,

      decisions,
    );

    const observation = await recordEvaluationScenario({
      scenario,

      target,
    });

    expect(observation.turns).toHaveLength(1);

    const turn = observation.turns[0]!;

    expect(turn.outcome).toBe('answer');

    expect(turn.finalText).toBe('Нашёл три мужские модели Nike.');

    expect(turn.llmCalls).toHaveLength(2);

    expect(turn.llmCalls.map((call) => call.name)).toEqual([
      'product_consultant',

      'product_consultant',
    ]);

    expect(
      turn.llmCalls.every(
        (call) =>
          call.provider === 'offline-stub' && call.usage.usageMissing === true,
      ),
    ).toBe(true);

    expect(
      turn.toolCalls.filter((call) => call.name === 'search_products'),
    ).toHaveLength(1);

    expect(turn.artifacts.map((artifact) => artifact.kind)).toEqual([
      'search_results',
    ]);

    expect(turn.resultMetadata).toEqual(
      expect.objectContaining({
        loopOutcome: 'completed',

        modelCalls: 2,

        capabilityRounds: 1,
      }),
    );

    const final = ConsultationApplicationRecordSchema.parse(
      observation.finalState,
    );

    expect(final.processedRequestIds).toEqual(['consultant-loop-t1']);

    expect(final.results.active?.products).toHaveLength(3);
  });

  it('passes deterministic call budget, search and artifact checks', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const target = new OfflineProductConsultantLoopTarget(
      fixture,

      decisions,
    );

    const result = await runDeterministicEvaluationScenario({
      scenario,

      target,
    });

    expect(result.checks).toHaveLength(4);

    expect(result.checks.every((check) => check.status === 'pass')).toBe(true);
  });
});
