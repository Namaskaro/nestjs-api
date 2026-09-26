import { describe, expect, it } from '@jest/globals';

import { resolve } from 'node:path';

import {
  createConsultationApplicationRecord,
  ConsultationApplicationRecordSchema,
} from '../../../application/runtime/consultation-application-record';

import { EvaluationScenarioSchema } from '../../contracts/evaluation-scenario';

import { loadCurrentProductConsultationFixture } from '../../fixtures/current-product-consultation.fixture';

import {
  recordEvaluationScenario,
  runDeterministicEvaluationScenario,
} from '../../run-evaluations';

import {
  OFFLINE_PRODUCT_CONSULTANT_WAIT_FOR_ABORT,
  OfflineProductConsultantLoopTarget,
} from '../offline-product-consultant-loop.target';

const fixturePath = resolve(
  process.cwd(),

  'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
);

function complete(text: string) {
  return {
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

    terminalText: text,
  };
}

const mainScenario = EvaluationScenarioSchema.parse({
  id: 'CONSULTANT-LOOP-REGRESSION',

  title: 'Product Consultant bounded loop regressions',

  description:
    'Search, mixed feedback recommendation and explicit new task boundary.',

  target: 'product_consultation',

  fixtureId: 'e01-current-catalog',

  initialState: null,

  turns: [
    {
      id: 'T1',

      kind: 'message',

      message: 'Найди мужские кроссовки Nike для повседневной носки',

      messageId: 'loop-regression-t1',
    },

    {
      id: 'T2',

      kind: 'message',

      message: 'Первый слишком массивный, что из остальных посоветуешь?',

      messageId: 'loop-regression-t2',
    },

    {
      id: 'T3',

      kind: 'message',

      message: 'Теперь хочу начать совсем новый подбор',

      messageId: 'loop-regression-t3',
    },
  ],

  checks: [
    {
      id: 't1-model-budget',

      evaluator: 'llm-call-budget',

      description: 'Initial search stays inside two model calls.',

      params: {
        turnId: 'T1',

        name: 'product_consultant',

        maxCalls: 2,
      },
    },

    {
      id: 't1-one-search',

      evaluator: 'tool-call-count',

      description: 'Initial search executes exactly once.',

      params: {
        turnId: 'T1',

        name: 'search_products',

        exact: 1,
      },
    },

    {
      id: 't2-model-budget',

      evaluator: 'llm-call-budget',

      description: 'Recommendation stays inside two model calls.',

      params: {
        turnId: 'T2',

        name: 'product_consultant',

        maxCalls: 2,
      },
    },

    {
      id: 't2-no-search',

      evaluator: 'tool-call-count',

      description: 'Recommendation does not trigger retrieval.',

      params: {
        turnId: 'T2',

        name: 'search_products',

        exact: 0,
      },
    },

    {
      id: 't2-one-details-read',

      evaluator: 'tool-call-count',

      description: 'Recommendation loads eligible candidate facts once.',

      params: {
        turnId: 'T2',

        name: 'get_product_details',

        exact: 1,
      },
    },

    {
      id: 't3-one-model-call',

      evaluator: 'llm-call-budget',

      description: 'Terminal start_new clarification needs one model call.',

      params: {
        turnId: 'T3',

        name: 'product_consultant',

        maxCalls: 1,
      },
    },

    {
      id: 't3-no-search',

      evaluator: 'tool-call-count',

      description: 'start_new CLARIFY does not search.',

      params: {
        turnId: 'T3',

        name: 'search_products',

        exact: 0,
      },
    },

    {
      id: 'no-errors',

      evaluator: 'no-errors',

      description: 'Regression flow has no harness errors.',

      params: {},
    },
  ],

  tags: [
    'offline',

    'consultant-loop',

    'regression',

    'feedback',

    'task-boundary',
  ],
});

const mainDecisions = {
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

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'для повседневной носки',

            importance: 'high',

            sourceText: 'Найди мужские кроссовки Nike для повседневной носки',
          },
        ],

        selection: null,

        feedback: null,
      },

      usageScenarioIds: ['daily_walking'],

      terminalText: null,
    },

    complete('Нашёл три мужские модели Nike.'),
  ],

  T2: [
    {
      proposal: {
        action: 'RECOMMEND',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: {
          kind: 'positions',

          positions: [2, 3],
        },

        feedback: {
          selection: {
            kind: 'positions',

            positions: [1],
          },

          reaction: 'dislike',

          reason: 'слишком массивный',

          attributeId: null,

          sourceText: 'Первый слишком массивный, что из остальных посоветуешь?',
        },
      },

      usageScenarioIds: ['daily_walking'],

      terminalText: null,
    },

    complete(
      'Из оставшихся вариантов можно рассматривать второй и третий; первый я исключил из текущего совета.',
    ),
  ],

  T3: [
    {
      proposal: {
        action: 'CLARIFY',

        taskTransition: 'start_new',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      usageScenarioIds: [],

      terminalText: 'Хорошо. Что именно хотите подобрать в новой задаче?',
    },
  ],
} as const;

describe('OfflineProductConsultantLoopTarget regressions', () => {
  it('handles feedback + recommendation without search and resets the old task on start_new', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const target = new OfflineProductConsultantLoopTarget(
      fixture,

      mainDecisions,
    );

    const observation = await recordEvaluationScenario({
      scenario: mainScenario,

      target,
    });

    expect(observation.turns).toHaveLength(3);

    const t1 = ConsultationApplicationRecordSchema.parse(
      observation.turns[0]!.stateAfter,
    );

    expect(t1.state?.memory.memory.goals).toEqual([
      expect.objectContaining({
        text: 'для повседневной носки',
      }),
    ]);

    expect(t1.results.active?.products).toHaveLength(3);

    const t2Observation = observation.turns[1]!;

    expect(
      t2Observation.toolCalls.filter((call) => call.name === 'search_products'),
    ).toHaveLength(0);

    expect(
      t2Observation.toolCalls.filter(
        (call) => call.name === 'get_product_details',
      ),
    ).toHaveLength(1);

    /**
     * Совет — текст.
     * Новых cards/comparison
     * автоматически не создаём.
     */
    expect(t2Observation.artifacts).toEqual([]);

    const t2 = ConsultationApplicationRecordSchema.parse(
      t2Observation.stateAfter,
    );

    expect(t2.state?.memory.memory.feedback).toEqual([
      expect.objectContaining({
        /**
         * First Nike from R1.
         *
         * ID разрешён backend-ом,
         * не пришёл от модели.
         */
        productId: '27807943-51e2-49fd-a0eb-4f3cd6568177',

        reaction: 'dislike',

        reason: 'слишком массивный',
      }),
    ]);

    expect(t2.state?.memory.memory.goals).toEqual([
      expect.objectContaining({
        text: 'для повседневной носки',
      }),
    ]);

    const t3 = ConsultationApplicationRecordSchema.parse(
      observation.turns[2]!.stateAfter,
    );

    /**
     * Explicit new task:
     *
     * старый SearchSpec,
     * memory и results
     * не протекают.
     */
    expect(t3.state?.search).toBeNull();

    expect(t3.state?.memory.memory.goals).toEqual([]);

    expect(t3.state?.memory.memory.criteria).toEqual([]);

    expect(t3.state?.memory.memory.feedback).toEqual([]);

    expect(t3.results.pendingSearch).toBeNull();

    expect(t3.results.active).toBeNull();

    expect(t3.results.lastConfirmed).toBeNull();

    expect(t3.processedRequestIds).toEqual([
      'loop-regression-t1',

      'loop-regression-t2',

      'loop-regression-t3',
    ]);
  });

  it('passes bounded call-budget and capability checks for the regression flow', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const result = await runDeterministicEvaluationScenario({
      scenario: mainScenario,

      target: new OfflineProductConsultantLoopTarget(
        fixture,

        mainDecisions,
      ),
    });

    expect(result.checks).toHaveLength(8);

    expect(result.checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('keeps authoritative state unchanged when model structured output is invalid', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const initialRecord = createConsultationApplicationRecord();

    const scenario = EvaluationScenarioSchema.parse({
      id: 'CONSULTANT-INVALID-OUTPUT',

      title: 'Invalid consultant structured output',

      description: null,

      target: 'product_consultation',

      fixtureId: 'e01-current-catalog',

      initialState: JSON.parse(JSON.stringify(initialRecord)),

      turns: [
        {
          id: 'T1',

          kind: 'message',

          message: 'Найди что-нибудь',

          messageId: 'invalid-output-t1',
        },
      ],

      checks: [],

      tags: ['invalid-output'],
    });

    const observation = await recordEvaluationScenario({
      scenario,

      target: new OfflineProductConsultantLoopTarget(
        fixture,

        {
          T1: [
            {
              nonsense: true,
            },
          ],
        },
      ),
    });

    expect(observation.turns[0]?.outcome).toBe('technical_failure');

    expect(observation.turns[0]?.resultMetadata).toEqual(
      expect.objectContaining({
        loopOutcome: 'interpretation_error',

        modelCalls: 1,

        capabilityRounds: 0,
      }),
    );

    expect(
      ConsultationApplicationRecordSchema.parse(
        observation.turns[0]!.stateAfter,
      ),
    ).toEqual(initialRecord);
  });

  it('times out a hanging model call without mutating authoritative state', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const initialRecord = createConsultationApplicationRecord();

    const scenario = EvaluationScenarioSchema.parse({
      id: 'CONSULTANT-TIMEOUT',

      title: 'Product Consultant timeout',

      description: null,

      target: 'product_consultation',

      fixtureId: 'e01-current-catalog',

      initialState: JSON.parse(JSON.stringify(initialRecord)),

      turns: [
        {
          id: 'T1',

          kind: 'message',

          message: 'Найди Nike',

          messageId: 'timeout-t1',
        },
      ],

      checks: [],

      tags: ['timeout'],
    });

    const observation = await recordEvaluationScenario({
      scenario,

      target: new OfflineProductConsultantLoopTarget(
        fixture,

        {
          T1: [OFFLINE_PRODUCT_CONSULTANT_WAIT_FOR_ABORT],
        },

        {
          modelTimeoutMs: 5,
        },
      ),
    });

    const turn = observation.turns[0]!;

    expect(turn.outcome).toBe('technical_failure');

    expect(turn.resultMetadata).toEqual(
      expect.objectContaining({
        loopOutcome: 'timeout',

        modelCalls: 1,

        capabilityRounds: 0,
      }),
    );

    expect(turn.llmCalls).toHaveLength(1);

    expect(turn.llmCalls[0]?.error).not.toBeNull();

    expect(turn.toolCalls).toEqual([]);

    expect(ConsultationApplicationRecordSchema.parse(turn.stateAfter)).toEqual(
      initialRecord,
    );
  });

  it('honours an already cancelled request without calling the model or mutating state', async () => {
    const fixture = await loadCurrentProductConsultationFixture(fixturePath);

    const initialRecord = createConsultationApplicationRecord();

    const controller = new AbortController();

    controller.abort();

    const scenario = EvaluationScenarioSchema.parse({
      id: 'CONSULTANT-CANCELLED',

      title: 'Cancelled Product Consultant request',

      description: null,

      target: 'product_consultation',

      fixtureId: 'e01-current-catalog',

      initialState: JSON.parse(JSON.stringify(initialRecord)),

      turns: [
        {
          id: 'T1',

          kind: 'message',

          message: 'Найди Nike',

          messageId: 'cancelled-t1',
        },
      ],

      checks: [],

      tags: ['cancellation'],
    });

    const observation = await recordEvaluationScenario({
      scenario,

      target: new OfflineProductConsultantLoopTarget(
        fixture,

        {
          /**
           * Не будет вызвано.
           */
          T1: [complete('Не должно быть вызвано.')],
        },

        {
          signal: controller.signal,
        },
      ),
    });

    const turn = observation.turns[0]!;

    expect(turn.outcome).toBe('interrupt');

    expect(turn.resultMetadata).toEqual(
      expect.objectContaining({
        loopOutcome: 'cancelled',

        modelCalls: 0,

        capabilityRounds: 0,
      }),
    );

    expect(turn.llmCalls).toEqual([]);

    expect(turn.toolCalls).toEqual([]);

    expect(ConsultationApplicationRecordSchema.parse(turn.stateAfter)).toEqual(
      initialRecord,
    );
  });
});
