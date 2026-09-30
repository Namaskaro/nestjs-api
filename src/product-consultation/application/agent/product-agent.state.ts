import { StateSchema } from '@langchain/langgraph';

import { z } from 'zod';

import {
  ProductContextSchema,
  ProductReferenceSchema,
} from '@/src/product-consultation/application/context/product-context.schema';

import { HandoffRequestSchema } from '@/src/support-agent/agents/handoff-agent/schemas/handoff.schema';

import {
  ConsultationCompletionPresentationSchema,
  ConsultationUserCompletionReasonSchema,
} from '@/src/product-consultation/application/session/consultation-lifecycle.schema';

import { ProductActionSchema } from '@/src/product-consultation/application/planner/product-planner-result.schema';

import { ProductSearchResultSchema } from '@/src/product-consultation/application/search/product-search-results.schema';

import { ConsultationAgentResultSchema } from '@/src/product-consultation/application/consultation-agent/schemas/consultation-agent.schema';

import {
  ConsultationApplicationRecordSchema,
  createConsultationApplicationRecord,
} from '@/src/product-consultation/application/runtime/consultation-application-record';

import { ProductConsultantDecisionSchema } from '@/src/product-consultation/application/consultant/product-consultant-decision.schema';

export const ProductTurnSchema = z.object({
  action: ProductActionSchema,

  products: z.array(ProductReferenceSchema).max(4),

  attributeIds: z.array(z.string()).max(8),

  reaction: z.enum(['like', 'dislike', 'mixed']).nullable(),

  completionReason: ConsultationUserCompletionReasonSchema.nullable(),

  handoffRequest: HandoffRequestSchema.nullable(),
});

export type ProductTurn = z.infer<typeof ProductTurnSchema>;

export const ProductAgentState = new StateSchema({
  query: z.string().min(1),

  conversationId: z.string().trim().min(1).nullable().default(null),

  requestId: z.string().trim().min(1).max(200).nullable().default(null),

  recentMessages: z
    .array(
      z
        .object({
          role: z.enum(['user', 'assistant']),

          text: z.string().trim().min(1).max(4000),
        })
        .strict(),
    )
    .max(6)
    .default(() => []),

  consultationRecord: ConsultationApplicationRecordSchema.default(
    createConsultationApplicationRecord,
  ),

  decision: ProductConsultantDecisionSchema.nullable().default(null),

  productContext: ProductContextSchema.nullable().default(null),

  turn: ProductTurnSchema.default(
    (): ProductTurn => ({
      action: 'CLARIFY',

      products: [],

      attributeIds: [],

      reaction: null,

      completionReason: null,

      handoffRequest: null,
    }),
  ),

  activeNeedIds: z
    .array(z.string().min(1))
    .max(5)
    .default(() => []),

  searchNeedIds: z
    .array(z.string().min(1))
    .max(5)
    .default(() => []),

  searchResults: z
    .array(
      ProductSearchResultSchema.extend({
        needId: z.string().min(1),
      }),
    )
    .max(5)
    .default(() => []),

  consultation: ConsultationAgentResultSchema.nullable().default(null),

  consultationCompletion:
    ConsultationCompletionPresentationSchema.nullable().default(null),

  message: z.string().min(1).nullable().default(null),
});

export type ProductAgentStateType = typeof ProductAgentState.State;

export type ProductAgentStateUpdate = typeof ProductAgentState.Update;
