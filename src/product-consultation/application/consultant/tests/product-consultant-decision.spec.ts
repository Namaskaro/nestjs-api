import { describe, expect, it } from '@jest/globals';

import {
  ProductConsultantDecisionSchema,
  productConsultantDecisionIsTerminal,
  productConsultantDecisionRequiresCapability,
} from '../product-consultant-decision.schema';

function nikeSearchProposal() {
  return {
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
  } as const;
}

describe('ProductConsultantDecision', () => {
  it('accepts SEARCH as non-terminal capability decision', () => {
    const decision = ProductConsultantDecisionSchema.parse({
      proposal: nikeSearchProposal(),

      usageScenarioIds: ['daily_walking'],

      terminalText: null,
    });

    expect(decision.proposal.action).toBe('SEARCH');

    expect(productConsultantDecisionRequiresCapability(decision)).toBe(true);

    expect(productConsultantDecisionIsTerminal(decision)).toBe(false);
  });

  it('accepts mixed feedback plus RECOMMEND without terminal text', () => {
    const decision = ProductConsultantDecisionSchema.parse({
      proposal: {
        action: 'RECOMMEND',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: {
          kind: 'positions',

          positions: [2],
        },

        feedback: {
          selection: {
            kind: 'positions',

            positions: [1],
          },

          reaction: 'dislike',

          reason: 'слишком массивный',

          attributeId: null,

          sourceText: 'Первый слишком массивный, посоветуй остальные',
        },
      },

      usageScenarioIds: ['daily_walking'],

      terminalText: null,
    });

    expect(decision.proposal.action).toBe('RECOMMEND');

    expect(productConsultantDecisionRequiresCapability(decision)).toBe(true);
  });

  it('accepts COMPLETE with terminal text', () => {
    const decision = ProductConsultantDecisionSchema.parse({
      proposal: {
        action: 'COMPLETE',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: null,
      },

      usageScenarioIds: ['daily_walking'],

      terminalText:
        'Для повседневной ходьбы второй вариант выглядит уместнее по подтверждённым характеристикам.',
    });

    expect(productConsultantDecisionRequiresCapability(decision)).toBe(false);

    expect(productConsultantDecisionIsTerminal(decision)).toBe(true);
  });

  it('accepts CLARIFY with semantic memory observation and terminal question', () => {
    const decision = ProductConsultantDecisionSchema.parse({
      proposal: {
        action: 'CLARIFY',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'для тренировок',

            importance: 'high',

            sourceText: 'Нужны для тренировок',
          },
        ],

        selection: null,

        feedback: null,
      },

      usageScenarioIds: ['training'],

      terminalText:
        'Для каких тренировок нужна обувь: бег, зал или другой тип нагрузки?',
    });

    expect(decision.proposal.action).toBe('CLARIFY');

    expect(productConsultantDecisionIsTerminal(decision)).toBe(true);
  });

  it('accepts pure FEEDBACK as terminal turn', () => {
    const decision = ProductConsultantDecisionSchema.parse({
      proposal: {
        action: 'FEEDBACK',

        taskTransition: 'continue',

        search: null,

        searchPatch: null,

        memoryObservations: [],

        selection: null,

        feedback: {
          selection: {
            kind: 'positions',

            positions: [1],
          },

          reaction: 'dislike',

          reason: 'слишком массивный',

          attributeId: null,

          sourceText: 'Первый слишком массивный',
        },
      },

      usageScenarioIds: [],

      terminalText: 'Понял, первый вариант исключаем из текущего совета.',
    });

    expect(productConsultantDecisionIsTerminal(decision)).toBe(true);
  });

  it('rejects terminal text before capability execution', () => {
    expect(() =>
      ProductConsultantDecisionSchema.parse({
        proposal: nikeSearchProposal(),

        usageScenarioIds: [],

        /**
         * Модель ещё не видела
         * search observation.
         *
         * Такой текст запрещён.
         */
        terminalText: 'Я нашёл три подходящих варианта.',
      }),
    ).toThrow(
      'SEARCH requires backend capability execution before terminal response',
    );
  });

  it('rejects terminal semantic action without terminal text', () => {
    expect(() =>
      ProductConsultantDecisionSchema.parse({
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

        terminalText: null,
      }),
    ).toThrow('COMPLETE requires terminal text');
  });

  it('rejects duplicate or excessive usage scenario IDs', () => {
    expect(() =>
      ProductConsultantDecisionSchema.parse({
        proposal: nikeSearchProposal(),

        usageScenarioIds: ['daily_walking', 'daily_walking'],

        terminalText: null,
      }),
    ).toThrow('duplicate usage scenario IDs');

    expect(() =>
      ProductConsultantDecisionSchema.parse({
        proposal: nikeSearchProposal(),

        usageScenarioIds: [
          'daily_walking',

          'wet_weather',

          'cold_weather',

          'training',
        ],

        terminalText: null,
      }),
    ).toThrow();
  });

  it('does not allow artifact or server-owned metadata in model output', () => {
    expect(
      ProductConsultantDecisionSchema.safeParse({
        proposal: nikeSearchProposal(),

        usageScenarioIds: [],

        terminalText: null,

        artifacts: [
          {
            kind: 'search_results',
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      ProductConsultantDecisionSchema.safeParse({
        proposal: nikeSearchProposal(),

        usageScenarioIds: [],

        terminalText: null,

        expectedResultId: 'result-secret',

        expectedRevision: 42,
      }).success,
    ).toBe(false);
  });
});
