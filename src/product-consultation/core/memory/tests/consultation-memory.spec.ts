import { describe, expect, it } from '@jest/globals';

import {
  applyConsultationMemoryPatch,
  createConsultationMemoryState,
} from '../consultation-memory';

function emptyPatch() {
  return {
    goals: {
      add: [],
      update: [],
      remove: [],
    },

    criteria: {
      add: [],
      update: [],
      remove: [],
    },

    feedback: {
      upsert: [],
      remove: [],
    },
  };
}

describe('ConsultationMemory', () => {
  it('creates empty persistent memory', () => {
    expect(createConsultationMemoryState()).toEqual({
      version: 1,

      revision: 0,

      memory: {
        goals: [],
        criteria: [],
        feedback: [],
      },
    });
  });

  it('stores daily wear as a goal', () => {
    const current = createConsultationMemoryState();

    const next = applyConsultationMemoryPatch(
      current,
      {
        expectedRevision: 0,

        patch: {
          ...emptyPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-daily-wear',
    );

    expect(next.revision).toBe(1);

    expect(next.memory.goals).toEqual([
      {
        goalId: 'goal-daily-wear',

        text: 'повседневная носка',

        importance: 'normal',

        sourceText: 'для повседневной носки',
      },
    ]);
  });

  it('does not touch memory when turn changes only SearchSpec', () => {
    const withGoal = applyConsultationMemoryPatch(
      createConsultationMemoryState(),
      {
        expectedRevision: 0,

        patch: {
          ...emptyPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-daily-wear',
    );

    /**
     * Например turn:
     *
     * "Окей, тогда Adidas"
     *
     * Меняется SearchSpec,
     * но memory delta отсутствует.
     */
    const afterBrandChange = applyConsultationMemoryPatch(withGoal, {
      expectedRevision: 1,

      patch: emptyPatch(),
    });

    expect(afterBrandChange).toEqual(withGoal);

    expect(afterBrandChange.revision).toBe(1);

    expect(afterBrandChange.memory.goals[0]?.text).toBe('повседневная носка');
  });

  it('preserves goal when another SearchSpec constraint is cleared', () => {
    const withGoal = applyConsultationMemoryPatch(
      createConsultationMemoryState(),
      {
        expectedRevision: 0,

        patch: {
          ...emptyPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-daily-wear',
    );

    /**
     * Например:
     * "цвет не важен"
     *
     * Это операция SearchSpec.
     * Memory остаётся прежней.
     */
    const afterColorClear = applyConsultationMemoryPatch(withGoal, {
      expectedRevision: 1,

      patch: emptyPatch(),
    });

    expect(afterColorClear.memory.goals).toEqual(withGoal.memory.goals);
  });

  it('updates an existing goal without changing its id', () => {
    const withGoal = applyConsultationMemoryPatch(
      createConsultationMemoryState(),
      {
        expectedRevision: 0,

        patch: {
          ...emptyPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-1',
    );

    const updated = applyConsultationMemoryPatch(withGoal, {
      expectedRevision: 1,

      patch: {
        ...emptyPatch(),

        goals: {
          add: [],

          update: [
            {
              goalId: 'goal-1',

              goal: {
                text: 'долгая ежедневная ходьба',

                importance: 'high',

                sourceText: 'я много хожу каждый день',
              },
            },
          ],

          remove: [],
        },
      },
    });

    expect(updated.memory.goals[0]).toEqual({
      goalId: 'goal-1',

      text: 'долгая ежедневная ходьба',

      importance: 'high',

      sourceText: 'я много хожу каждый день',
    });
  });

  it('removes only explicitly removed goal', () => {
    let id = 0;

    const withGoals = applyConsultationMemoryPatch(
      createConsultationMemoryState(),
      {
        expectedRevision: 0,

        patch: {
          ...emptyPatch(),

          goals: {
            add: [
              {
                text: 'повседневная носка',

                importance: 'normal',

                sourceText: 'для повседневной носки',
              },

              {
                text: 'долгие прогулки',

                importance: 'normal',

                sourceText: 'ещё много гуляю',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => `goal-${++id}`,
    );

    const next = applyConsultationMemoryPatch(withGoals, {
      expectedRevision: 1,

      patch: {
        ...emptyPatch(),

        goals: {
          add: [],

          update: [],

          remove: [
            {
              goalId: 'goal-2',

              sourceText: 'прогулки больше не важны',
            },
          ],
        },
      },
    });

    expect(next.memory.goals.map((goal) => goal.goalId)).toEqual(['goal-1']);
  });

  it('rejects stale revision', () => {
    expect(() =>
      applyConsultationMemoryPatch(createConsultationMemoryState(), {
        expectedRevision: 4,

        patch: emptyPatch(),
      }),
    ).toThrow('stale revision');
  });
});
