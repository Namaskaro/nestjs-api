import { z } from 'zod';

import { SearchSpecDraftSchema } from '../search/search-spec.schema';

import { ConsultationStateDeltaSchema } from '../state/consultation-state.schema';

export const ConsultationActionSchema = z.enum([
  'SEARCH',
  'REFINE',
  'RELAX_CONSTRAINTS',
  'ALTERNATIVES',
  'SHOW_RESULTS',
  'COMPARE',
  'DETAILS',
  'RECOMMEND',
  'FEEDBACK',
  'COMPLETE',
  'CLARIFY',
  'HANDOFF',
]);

export const ProductSelectionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('active'),
    })
    .strict(),

  z
    .object({
      kind: z.literal('positions'),

      positions: z
        .array(z.number().int().min(1).max(25))
        .min(1)
        .max(4)
        .refine(
          (positions) => new Set(positions).size === positions.length,

          {
            message: 'Product selection positions must be unique.',
          },
        ),
    })
    .strict(),
]);

export const TurnFeedbackSchema = z
  .object({
    reaction: z.enum(['like', 'dislike', 'mixed']),

    reason: z.string().trim().min(1).max(500).nullable(),

    attributeId: z.string().trim().min(1).max(160).nullable(),

    sourceText: z.string().trim().min(1).max(500),
  })
  .strict();

const ACTIONS_REQUIRING_SELECTION = new Set([
  'COMPARE',
  'DETAILS',
  'RECOMMEND',
  'FEEDBACK',
]);

const PATCH_SEARCH_ACTIONS = new Set(['REFINE', 'RELAX_CONSTRAINTS']);

export const ConsultationTurnInterpretationSchema = z
  .object({
    action: ConsultationActionSchema,

    /**
     * Полный SearchSpec только
     * для нового независимого SEARCH.
     */
    search: SearchSpecDraftSchema.nullable().default(null),

    /**
     * Semantic delta текущей задачи.
     *
     * Важное ownership rule:
     *
     * SearchSpec:
     *   фактически исполняемые ограничения.
     *
     * Memory criteria:
     *   предпочтения для reasoning /
     *   recommendation.
     *
     * Поэтому внешний interpreter
     * не имеет права создавать
     * required memory criteria.
     */
    delta: ConsultationStateDeltaSchema.default(() => ({})),

    selection: ProductSelectionSchema.nullable().default(null),

    feedback: TurnFeedbackSchema.nullable().default(null),
  })
  .strict()
  .superRefine((interpretation, context) => {
    if (interpretation.action === 'SEARCH' && interpretation.search === null) {
      context.addIssue({
        code: 'custom',

        path: ['search'],

        message: 'SEARCH requires a complete SearchSpec.',
      });
    }

    if (interpretation.action !== 'SEARCH' && interpretation.search !== null) {
      context.addIssue({
        code: 'custom',

        path: ['search'],

        message: `${interpretation.action} cannot contain a complete SearchSpec.`,
      });
    }

    if (
      interpretation.action === 'SEARCH' &&
      interpretation.delta.search !== undefined
    ) {
      context.addIssue({
        code: 'custom',

        path: ['delta', 'search'],

        message: 'SEARCH cannot contain SearchSpec patch.',
      });
    }

    if (
      interpretation.delta.search !== undefined &&
      !PATCH_SEARCH_ACTIONS.has(interpretation.action)
    ) {
      context.addIssue({
        code: 'custom',

        path: ['delta', 'search'],

        message: `${interpretation.action} cannot mutate SearchSpec.`,
      });
    }

    /**
     * SearchSpec — единственный владелец
     * hard executable requirements.
     *
     * Memory criterion с required=true
     * с внешней Turn boundary запрещён.
     */
    const memoryCriteria = interpretation.delta.memory?.criteria;

    if (memoryCriteria) {
      for (let index = 0; index < memoryCriteria.add.length; index += 1) {
        if (memoryCriteria.add[index]?.required === true) {
          context.addIssue({
            code: 'custom',

            path: ['delta', 'memory', 'criteria', 'add', index, 'required'],

            message:
              'Required search constraints belong to SearchSpec, not Memory.',
          });
        }
      }

      for (let index = 0; index < memoryCriteria.update.length; index += 1) {
        if (memoryCriteria.update[index]?.criterion.required === true) {
          context.addIssue({
            code: 'custom',

            path: [
              'delta',
              'memory',
              'criteria',
              'update',
              index,
              'criterion',
              'required',
            ],

            message:
              'Required search constraints belong to SearchSpec, not Memory.',
          });
        }
      }
    }

    const requiresSelection = ACTIONS_REQUIRING_SELECTION.has(
      interpretation.action,
    );

    if (requiresSelection && interpretation.selection === null) {
      context.addIssue({
        code: 'custom',

        path: ['selection'],

        message: `${interpretation.action} requires product selection.`,
      });
    }

    if (!requiresSelection && interpretation.selection !== null) {
      context.addIssue({
        code: 'custom',

        path: ['selection'],

        message: `${interpretation.action} cannot contain product selection.`,
      });
    }

    const memoryFeedback = interpretation.delta.memory?.feedback;

    if (
      memoryFeedback &&
      (memoryFeedback.upsert.length > 0 || memoryFeedback.remove.length > 0)
    ) {
      context.addIssue({
        code: 'custom',

        path: ['delta', 'memory', 'feedback'],

        message: 'Feedback memory mutations are server-owned.',
      });
    }

    if (
      interpretation.action === 'FEEDBACK' &&
      interpretation.feedback === null
    ) {
      context.addIssue({
        code: 'custom',

        path: ['feedback'],

        message: 'FEEDBACK requires semantic feedback.',
      });
    }

    if (
      interpretation.action !== 'FEEDBACK' &&
      interpretation.feedback !== null
    ) {
      context.addIssue({
        code: 'custom',

        path: ['feedback'],

        message: `${interpretation.action} cannot contain feedback.`,
      });
    }

    if (
      interpretation.action === 'COMPARE' &&
      interpretation.selection?.kind === 'positions' &&
      interpretation.selection.positions.length < 2
    ) {
      context.addIssue({
        code: 'custom',

        path: ['selection', 'positions'],

        message: 'COMPARE requires at least two positions.',
      });
    }

    if (
      interpretation.action === 'DETAILS' &&
      interpretation.selection?.kind === 'positions' &&
      interpretation.selection.positions.length !== 1
    ) {
      context.addIssue({
        code: 'custom',

        path: ['selection', 'positions'],

        message: 'DETAILS requires exactly one position.',
      });
    }

    if (
      interpretation.action === 'FEEDBACK' &&
      interpretation.selection?.kind === 'positions' &&
      interpretation.selection.positions.length !== 1
    ) {
      context.addIssue({
        code: 'custom',

        path: ['selection', 'positions'],

        message: 'FEEDBACK requires exactly one position.',
      });
    }
  });

export type ConsultationAction = z.infer<typeof ConsultationActionSchema>;

export type ProductSelection = z.infer<typeof ProductSelectionSchema>;

export type TurnFeedback = z.infer<typeof TurnFeedbackSchema>;

export type ConsultationTurnInterpretation = z.infer<
  typeof ConsultationTurnInterpretationSchema
>;
