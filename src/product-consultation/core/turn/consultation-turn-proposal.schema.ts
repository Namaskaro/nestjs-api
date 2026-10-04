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

export const TurnFeedbackObservationSchema = TurnFeedbackSchema.extend({
  selection: ProductSelectionSchema,
}).strict();

const START_NEW_ACTIONS = new Set<string>(['SEARCH', 'CLARIFY']);

export const ConsultationTurnProposalSchema = z
  .object({
    action: PublicConsultationActionSchema,

    taskTransition: ConsultationTaskTransitionSchema,

    search: SearchSpecDraftSchema.nullable().default(null),

    searchPatch: SearchSpecPatchSchema.nullable().default(null),

    memoryObservations: ConsultationMemoryObservationsSchema.default(() => []),

    selection: ProductSelectionSchema.nullable().default(null),

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

    // SEARCH may continue a task that has only clarified requirements so far.
    // Whether a search has already run is checked at the state-aware boundary.

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
