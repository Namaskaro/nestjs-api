import { MessagesValue, StateSchema } from '@langchain/langgraph';

import { z } from 'zod';

import {
  HandoffContextSchema,
  HandoffRequestSchema,
  HandoffSchema,
} from './schemas/handoff.schema';

import { OperatorOfferResumeSchema } from './schemas/operator-offer.schema';

export const HandoffState = new StateSchema({
  messages: MessagesValue,

  handoffRequest: HandoffRequestSchema.nullable().default(null),

  operatorOfferDecision: OperatorOfferResumeSchema.shape.decision
    .nullable()
    .default(null),

  preparationStatus: z
    .enum(['READY', 'NEEDS_CLARIFICATION'])
    .nullable()
    .default(null),

  // START ИЗМЕНЕНИЙ — ПОДГОТОВЛЕННЫЙ КОНТЕКСТ
  preparedContext: HandoffContextSchema.nullable().default(null),
  // END ИЗМЕНЕНИЙ — ПОДГОТОВЛЕННЫЙ КОНТЕКСТ

  operatorClarificationQuestion: z.string().nullable().default(null),

  operatorClarificationAnswer: z.string().nullable().default(null),

  handoff: HandoffSchema.nullable().default(null),
});

export type HandoffStateType = typeof HandoffState.State;

export type HandoffStateUpdate = typeof HandoffState.Update;
