import { describe, expect, it } from '@jest/globals';

import { EvaluationScenarioSchema } from './evaluation-scenario';

function baseScenario() {
  return {
    id: 'E-test',

    title: 'Evaluation scenario contract',

    description: null,

    target: 'product_consultation' as const,

    fixtureId: null,

    initialState: null,

    turns: [
      {
        id: 'T1',

        kind: 'message' as const,

        message: 'Найди мужские кроссовки Nike',

        messageId: null,
      },

      {
        id: 'T2',

        kind: 'message' as const,

        message: 'Хочу зелёные',

        messageId: null,
      },
    ],

    checks: [
      {
        id: 'no-errors',

        evaluator: 'no-errors',

        description: 'Scenario не должен содержать runtime errors.',

        params: {},
      },
    ],

    tags: ['test'],
  };
}

describe('EvaluationScenarioSchema', () => {
  it('accepts scenario with unique turn and check IDs', () => {
    const parsed = EvaluationScenarioSchema.safeParse(baseScenario());

    expect(parsed.success).toBe(true);
  });

  it('rejects duplicate turn IDs', () => {
    const scenario = baseScenario();

    scenario.turns[1] = {
      id: 'T1',

      kind: 'message',

      message: 'Тогда Adidas',

      messageId: null,
    };

    const parsed = EvaluationScenarioSchema.safeParse(scenario);

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(
        parsed.error.issues.some(
          (issue) =>
            issue.message ===
            'Evaluation turn id "T1" используется несколько раз.',
        ),
      ).toBe(true);

      expect(
        parsed.error.issues.some(
          (issue) => issue.path.join('.') === 'turns.1.id',
        ),
      ).toBe(true);
    }
  });

  it('also rejects duplicate turn ID across message and resume turns', () => {
    const scenario = baseScenario();

    scenario.turns[1] = {
      id: 'T1',

      kind: 'resume',

      value: {
        approved: true,
      },
    } as never;

    const parsed = EvaluationScenarioSchema.safeParse(scenario);

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(
        parsed.error.issues.some(
          (issue) =>
            issue.message ===
            'Evaluation turn id "T1" используется несколько раз.',
        ),
      ).toBe(true);
    }
  });

  it('rejects duplicate check IDs', () => {
    const scenario = baseScenario();

    scenario.checks.push({
      id: 'no-errors',

      evaluator: 'tool-call-count',

      description: 'Другая проверка с тем же ID.',

      params: {},
    });

    const parsed = EvaluationScenarioSchema.safeParse(scenario);

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(
        parsed.error.issues.some(
          (issue) =>
            issue.message ===
            'Evaluation check id "no-errors" используется несколько раз.',
        ),
      ).toBe(true);
    }
  });
});
