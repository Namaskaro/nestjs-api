import { describe, expect, it } from '@jest/globals';

import {
  applyConsultationMemoryPatch,
  createConsultationMemoryState,
} from '../consultation-memory';

import { compileConsultationMemoryObservations } from '../consultation-memory-observation';

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

describe('ConsultationMemoryObservation', () => {
  it('turns new semantic goal into internal add patch', () => {
    const patch = compileConsultationMemoryObservations(
      createConsultationMemoryState(),

      [
        {
          kind: 'goal',

          operation: 'remember',

          text: 'повседневная носка',

          importance: 'normal',

          sourceText: 'нужны на каждый день',
        },
      ],
    );

    expect(patch.goals.add).toEqual([
      {
        text: 'повседневная носка',

        importance: 'normal',

        sourceText: 'нужны на каждый день',
      },
    ]);

    expect(patch.goals.update).toEqual([]);

    expect(patch.goals.remove).toEqual([]);
  });

  it('does not expose or require goalId for new goal', () => {
    const patch = compileConsultationMemoryObservations(
      createConsultationMemoryState(),

      [
        {
          kind: 'goal',

          operation: 'remember',

          text: 'долгие прогулки',

          importance: 'high',

          sourceText: 'я много хожу',
        },
      ],
    );

    expect('goalId' in patch.goals.add[0]!).toBe(false);
  });

  it('repeating the same goal becomes a no-op', () => {
    const current = applyConsultationMemoryPatch(
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

                sourceText: 'на каждый день',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'goal-daily',
    );

    const patch = compileConsultationMemoryObservations(
      current,

      [
        {
          kind: 'goal',

          operation: 'remember',

          text: 'Повседневная   носка',

          importance: 'normal',

          sourceText: 'по-прежнему на каждый день',
        },
      ],
    );

    expect(patch).toEqual(emptyPatch());
  });

  it('rejects duplicate goals with only whitespace and case differences in one turn', () => {
    expect(() =>
      compileConsultationMemoryObservations(
        createConsultationMemoryState(),

        [
          {
            kind: 'goal',

            operation: 'remember',

            text: 'Долгие   прогулки',

            importance: 'normal',

            sourceText: 'я много хожу пешком',
          },

          {
            kind: 'goal',

            operation: 'remember',

            text: 'долгие прогулки',

            importance: 'high',

            sourceText: 'для меня важны долгие прогулки',
          },
        ],
      ),
    ).toThrow('Duplicate memory observation target: goal:долгие прогулки');
  });

  it('backend chooses goalId when existing goal changes', () => {
    const current = applyConsultationMemoryPatch(
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

                sourceText: 'на каждый день',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'server-goal-id',
    );

    const patch = compileConsultationMemoryObservations(
      current,

      [
        {
          kind: 'goal',

          operation: 'remember',

          text: 'повседневная носка',

          importance: 'high',

          sourceText: 'это особенно важно',
        },
      ],
    );

    expect(patch.goals.update).toEqual([
      {
        goalId: 'server-goal-id',

        goal: {
          text: 'повседневная носка',

          importance: 'high',

          sourceText: 'это особенно важно',
        },
      },
    ]);
  });

  it('backend chooses goalId when goal is forgotten', () => {
    const current = applyConsultationMemoryPatch(
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

                sourceText: 'на каждый день',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'server-goal-id',
    );

    const patch = compileConsultationMemoryObservations(
      current,

      [
        {
          kind: 'goal',

          operation: 'forget',

          text: 'повседневная носка',

          sourceText: 'это уже не важно',
        },
      ],
    );

    expect(patch.goals.remove).toEqual([
      {
        goalId: 'server-goal-id',

        sourceText: 'это уже не важно',
      },
    ]);
  });

  it('forgetting unknown goal is a safe no-op', () => {
    const patch = compileConsultationMemoryObservations(
      createConsultationMemoryState(),

      [
        {
          kind: 'goal',

          operation: 'forget',

          text: 'неизвестная цель',

          sourceText: 'это больше не важно',
        },
      ],
    );

    expect(patch).toEqual(emptyPatch());
  });

  it('turns preference observation into non-required criterion', () => {
    const patch = compileConsultationMemoryObservations(
      createConsultationMemoryState(),

      [
        {
          kind: 'criterion',

          operation: 'remember',

          attributeId: 'weight',

          operator: 'lte',

          value: 0.5,

          unit: 'kg',

          importance: 'high',

          sourceText: 'хочу что-нибудь полегче',
        },
      ],
    );

    expect(patch.criteria.add).toEqual([
      {
        attributeId: 'weight',

        operator: 'lte',

        value: 0.5,

        unit: 'kg',

        required: false,

        importance: 'high',

        sourceText: 'хочу что-нибудь полегче',
      },
    ]);
  });

  it('backend updates criterion using its server-owned id', () => {
    const current = applyConsultationMemoryPatch(
      createConsultationMemoryState(),

      {
        expectedRevision: 0,

        patch: {
          ...emptyPatch(),

          criteria: {
            add: [
              {
                attributeId: 'weight',

                operator: 'lte',

                value: 0.6,

                unit: 'kg',

                required: false,

                importance: 'normal',

                sourceText: 'желательно полегче',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'server-criterion-id',
    );

    const patch = compileConsultationMemoryObservations(
      current,

      [
        {
          kind: 'criterion',

          operation: 'remember',

          attributeId: 'weight',

          operator: 'lte',

          value: 0.5,

          unit: 'kg',

          importance: 'high',

          sourceText: 'лучше до половины килограмма',
        },
      ],
    );

    expect(patch.criteria.update).toEqual([
      {
        criterionId: 'server-criterion-id',

        criterion: {
          attributeId: 'weight',

          operator: 'lte',

          value: 0.5,

          unit: 'kg',

          required: false,

          importance: 'high',

          sourceText: 'лучше до половины килограмма',
        },
      },
    ]);
  });

  it('backend removes criterion by semantic key instead of external id', () => {
    const current = applyConsultationMemoryPatch(
      createConsultationMemoryState(),

      {
        expectedRevision: 0,

        patch: {
          ...emptyPatch(),

          criteria: {
            add: [
              {
                attributeId: 'weight',

                operator: 'lte',

                value: 0.5,

                unit: 'kg',

                required: false,

                importance: 'high',

                sourceText: 'хочу полегче',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      () => 'server-criterion-id',
    );

    const patch = compileConsultationMemoryObservations(
      current,

      [
        {
          kind: 'criterion',

          operation: 'forget',

          attributeId: 'weight',

          operator: 'lte',

          sourceText: 'вес больше не важен',
        },
      ],
    );

    expect(patch.criteria.remove).toEqual([
      {
        criterionId: 'server-criterion-id',

        sourceText: 'вес больше не важен',
      },
    ]);
  });

  it('rejects two observations targeting the same criterion slot', () => {
    expect(() =>
      compileConsultationMemoryObservations(
        createConsultationMemoryState(),

        [
          {
            kind: 'criterion',

            operation: 'remember',

            attributeId: 'weight',

            operator: 'lte',

            value: 0.5,

            unit: 'kg',

            importance: 'high',

            sourceText: 'хочу легче',
          },

          {
            kind: 'criterion',

            operation: 'forget',

            attributeId: 'weight',

            operator: 'lte',

            sourceText: 'вес не важен',
          },
        ],
      ),
    ).toThrow('Duplicate memory observation target');
  });
});
