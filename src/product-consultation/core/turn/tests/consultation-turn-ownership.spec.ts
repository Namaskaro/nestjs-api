import { describe, expect, it } from '@jest/globals';

import { ConsultationTurnInterpretationSchema } from '../consultation-turn.schema';

function emptyMemoryPatch() {
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

describe('ConsultationTurn ownership rules', () => {
  it('allows hard executable requirement in SearchSpec', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'SEARCH',

      search: {
        semanticIntent: 'мужские кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'price',

            operator: 'lte',

            value: 20000,

            unit: 'RUB',
          },
        ],
      },

      delta: {},

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(true);
  });

  it('allows non-required preference in Memory', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'CLARIFY',

      search: null,

      delta: {
        memory: {
          ...emptyMemoryPatch(),

          criteria: {
            add: [
              {
                attributeId: 'weight',

                operator: 'lte',

                value: 400,

                unit: 'g',

                required: false,

                importance: 'high',

                sourceText: 'хочу что-нибудь полегче',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects required criterion added to Memory', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'CLARIFY',

      search: null,

      delta: {
        memory: {
          ...emptyMemoryPatch(),

          criteria: {
            add: [
              {
                attributeId: 'price',

                operator: 'lte',

                value: 15000,

                unit: 'RUB',

                required: true,

                importance: 'high',

                sourceText: 'дороже 15 тысяч не предлагай',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(
        parsed.error.issues.some(
          (issue) =>
            issue.message ===
            'Required search constraints belong to SearchSpec, not Memory.',
        ),
      ).toBe(true);
    }
  });

  it('rejects required criterion update through Memory', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'CLARIFY',

      search: null,

      delta: {
        memory: {
          ...emptyMemoryPatch(),

          criteria: {
            add: [],

            update: [
              {
                criterionId: 'criterion-price',

                criterion: {
                  attributeId: 'price',

                  operator: 'lte',

                  value: 15000,

                  unit: 'RUB',

                  required: true,

                  importance: 'high',

                  sourceText: 'теперь это обязательный бюджет',
                },
              },
            ],

            remove: [],
          },
        },
      },

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('allows SearchSpec hard limit and softer Memory preference to coexist', () => {
    const parsed = ConsultationTurnInterpretationSchema.safeParse({
      action: 'SEARCH',

      search: {
        semanticIntent: 'мужские кроссовки для повседневной носки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'price',

            operator: 'lte',

            value: 20000,

            unit: 'RUB',
          },
        ],
      },

      delta: {
        memory: {
          ...emptyMemoryPatch(),

          criteria: {
            add: [
              {
                attributeId: 'price',

                operator: 'lte',

                value: 15000,

                unit: 'RUB',

                required: false,

                importance: 'normal',

                sourceText: 'желательно уложиться в 15 тысяч',
              },
            ],

            update: [],

            remove: [],
          },
        },
      },

      selection: null,

      feedback: null,
    });

    expect(parsed.success).toBe(true);
  });
});
