import { z } from 'zod';

import { SearchSpecDraftSchema } from '../search/search-spec.schema';

import { ConsultationStateDeltaSchema } from '../state/consultation-state.schema';

/**
 * INTERNAL action contract.
 *
 * RELAX_CONSTRAINTS / ALTERNATIVES пока оставлены
 * только для совместимости старого internal кода.
 *
 * Public Product Consultant их больше не видит.
 */
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

/**
 * Единственный набор actions,
 * который разрешено отдавать будущей LLM.
 *
 * Ослабление constraints = REFINE.
 *
 * ALTERNATIVES пока не имеет отдельной
 * deterministic backend semantics,
 * поэтому наружу его не выставляем.
 */
export const PublicConsultationActionSchema = z.enum([
  'SEARCH',
  'REFINE',
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

      /**
       * Здесь только общий safety limit.
       *
       * DETAILS / COMPARE / RECOMMEND /
       * FEEDBACK проверяют собственную
       * cardinality уже после resolution.
       *
       * Благодаря этому здесь больше нет
       * конфликта:
       *
       * generic max=4
       * vs RECOMMEND max=5.
       */
      positions: z
        .array(z.number().int().min(1).max(25))
        .min(1)
        .max(25)
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

    search: SearchSpecDraftSchema.nullable().default(null),

    /**
     * INTERNAL state delta.
     *
     * Public Product Consultant этот объект
     * больше напрямую не контролирует.
     */
    delta: ConsultationStateDeltaSchema.default(() => ({})),

    selection: ProductSelectionSchema.nullable().default(null),

    /**
     * INTERNAL semantic feedback.
     *
     * Для mixed-operation public feedback
     * boundary сама создаёт server-owned
     * Memory mutation.
     *
     * Здесь feedback остаётся нужен
     * для чистого action=FEEDBACK.
     */
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
     * SearchSpec — владелец hard constraints.
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

    /**
     * ВАЖНО:
     *
     * Раньше здесь запрещался
     * delta.memory.feedback.
     *
     * Это было нужно, пока interpretation
     * могла приходить прямо от LLM.
     *
     * Теперь interpretation INTERNAL,
     * а public boundary сама привязывает
     * feedback к server-owned productId.
     *
     * Поэтому internal Memory feedback
     * здесь разрешён.
     */

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

export type PublicConsultationAction = z.infer<
  typeof PublicConsultationActionSchema
>;

export type ProductSelection = z.infer<typeof ProductSelectionSchema>;

export type TurnFeedback = z.infer<typeof TurnFeedbackSchema>;

export type ConsultationTurnInterpretation = z.infer<
  typeof ConsultationTurnInterpretationSchema
>;
