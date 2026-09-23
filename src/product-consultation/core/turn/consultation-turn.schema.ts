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

export const InitialSearchSpecSchema = SearchSpecDraftSchema;

/**
 * Ссылка на товары из единственного
 * server-owned active product set.
 *
 * active:
 * использовать текущий активный набор.
 *
 * positions:
 * использовать конкретные позиции
 * текущего активного набора.
 *
 * Здесь намеренно нет:
 *
 * - productId от LLM;
 * - needIndex;
 * - display/comparison source;
 * - referenceOrder.
 */
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
        .refine((positions) => new Set(positions).size === positions.length, {
          message: 'Product selection positions must be unique.',
        }),
    })
    .strict(),
]);

const ACTIONS_REQUIRING_SELECTION = new Set([
  'COMPARE',
  'DETAILS',
  'RECOMMEND',
  'FEEDBACK',
]);

export const ConsultationTurnInterpretationSchema = z
  .object({
    action: ConsultationActionSchema,

    /**
     * Только первый SEARCH.
     */
    initialSearch: InitialSearchSpecSchema.nullable().default(null),

    /**
     * Только semantic state delta.
     */
    delta: ConsultationStateDeltaSchema.default(() => ({})),

    /**
     * Semantic reference на товары.
     *
     * Реальные productId позже разрешает
     * deterministic reference resolver.
     */
    selection: ProductSelectionSchema.nullable().default(null),
  })
  .strict()
  .superRefine((interpretation, context) => {
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

export type InitialSearchSpec = z.infer<typeof InitialSearchSpecSchema>;

export type ProductSelection = z.infer<typeof ProductSelectionSchema>;

export type ConsultationTurnInterpretation = z.infer<
  typeof ConsultationTurnInterpretationSchema
>;
