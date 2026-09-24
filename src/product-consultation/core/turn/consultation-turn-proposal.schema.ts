import { z } from 'zod';

import { ConsultationMemoryObservationsSchema } from '../memory/consultation-memory-observation.schema';

import {
  SearchSpecDraftSchema,
  SearchSpecPatchSchema,
} from '../search/search-spec.schema';

import {
  ProductSelectionSchema,
  PublicConsultationActionSchema,
  TurnFeedbackSchema,
} from './consultation-turn.schema';

export const ConsultationTaskTransitionSchema = z.enum([
  'continue',
  'start_new',
]);

/**
 * Public semantic feedback observation.
 *
 * Здесь НЕТ productId.
 *
 * Вместо этого модель указывает
 * ordinal selection:
 *
 * "первый слишком массивный"
 *
 * Backend сам разрешает:
 *
 * first → productId.
 */
export const TurnFeedbackObservationSchema = TurnFeedbackSchema.extend({
  selection: ProductSelectionSchema,
}).strict();

const START_NEW_ACTIONS = new Set<string>(['SEARCH', 'CLARIFY']);

export const ConsultationTurnProposalSchema = z
  .object({
    /**
     * Только публичные действия.
     *
     * RELAX_CONSTRAINTS / ALTERNATIVES
     * будущая LLM здесь выбрать не может.
     */
    action: PublicConsultationActionSchema,

    taskTransition: ConsultationTaskTransitionSchema,

    search: SearchSpecDraftSchema.nullable().default(null),

    searchPatch: SearchSpecPatchSchema.nullable().default(null),

    memoryObservations: ConsultationMemoryObservationsSchema.default(() => []),

    /**
     * Selection главной операции.
     *
     * Например:
     *
     * RECOMMEND → [2, 3]
     *
     * При action=FEEDBACK selection
     * главной операции не используется:
     * target находится внутри feedback.
     */
    selection: ProductSelectionSchema.nullable().default(null),

    /**
     * Feedback — observation,
     * а не обязательно главный action.
     *
     * Поэтому допустимо:
     *
     * action = RECOMMEND
     *
     * selection = [2, 3]
     *
     * feedback.selection = [1]
     */
    feedback: TurnFeedbackObservationSchema.nullable().default(null),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (
      proposal.taskTransition === 'start_new' &&
      !START_NEW_ACTIONS.has(proposal.action)
    ) {
      context.addIssue({
        code: 'custom',

        path: ['taskTransition'],

        message: `start_new is not compatible with action ${proposal.action}.`,
      });
    }

    if (
      proposal.taskTransition === 'start_new' &&
      proposal.selection !== null
    ) {
      context.addIssue({
        code: 'custom',

        path: ['selection'],

        message: 'New task cannot select products from the previous task.',
      });
    }

    if (proposal.taskTransition === 'start_new' && proposal.feedback !== null) {
      context.addIssue({
        code: 'custom',

        path: ['feedback'],

        message: 'New task cannot contain feedback for the previous task.',
      });
    }

    /**
     * Pure FEEDBACK:
     *
     * target хранится только
     * внутри feedback.selection.
     *
     * Не поддерживаем два независимых
     * selection target одновременно.
     */
    if (proposal.action === 'FEEDBACK' && proposal.selection !== null) {
      context.addIssue({
        code: 'custom',

        path: ['selection'],

        message: 'FEEDBACK target belongs to feedback.selection.',
      });
    }

    if (proposal.action === 'FEEDBACK' && proposal.feedback === null) {
      context.addIssue({
        code: 'custom',

        path: ['feedback'],

        message: 'FEEDBACK requires semantic feedback observation.',
      });
    }
  });

export type ConsultationTaskTransition = z.infer<
  typeof ConsultationTaskTransitionSchema
>;

export type TurnFeedbackObservation = z.infer<
  typeof TurnFeedbackObservationSchema
>;

export type ConsultationTurnProposal = z.infer<
  typeof ConsultationTurnProposalSchema
>;
