import z from 'zod';

import { ProductItemSchema } from '@/src/product-consultation/application/agent/product-agent-result.schema';

import { ConsultationAgentResultSchema } from '@/src/product-consultation/application/consultation-agent/schemas/consultation-agent.schema';

import { ConsultationCompletionPresentationSchema } from '@/src/product-consultation/application/session/consultation-lifecycle.schema';

import { ComparisonPresentationSchema } from '../presentation/comparison-presentation.schema';

import { ProductDetailsPresentationSchema } from '../presentation/product-presentation.schema';

import { ZeroResultRecoverySchema } from '../search/zero-result-recovery';

const ActionPresentationBaseSchema = z.object({
  actionOrdinal: z.number().int().nonnegative(),
});

export const ProductActionPresentationSchema = z.discriminatedUnion(
  'kind',

  [
    ActionPresentationBaseSchema.extend({
      kind: z.literal('comparison'),

      data: ComparisonPresentationSchema,
    }),

    ActionPresentationBaseSchema.extend({
      kind: z.literal('details'),

      data: ProductDetailsPresentationSchema,
    }),

    ActionPresentationBaseSchema.extend({
      kind: z.literal('recommendation'),

      message: z.string().min(1),

      productIds: z.array(z.string().min(1)).min(1),

      product: ProductItemSchema,
    }),
  ],
);

export type ProductActionPresentation = z.infer<
  typeof ProductActionPresentationSchema
>;

export const ProductAnswerGroupSchema = z.object({
  taskId: z.string().optional(),

  status: z
    .enum(['ready', 'empty', 'failed', 'clarification', 'closed'])
    .optional(),

  consultation: ConsultationAgentResultSchema.nullable().optional(),

  presentations: z.array(ProductActionPresentationSchema).optional(),

  recovery: ZeroResultRecoverySchema.optional(),

  query: z.string(),

  message: z.string(),

  products: z.array(ProductItemSchema),
});

export const ProductAgentMessageSchema = z.object({
  message: z.string(),

  groups: z.array(
    z.object({
      query: z.string(),

      message: z.string(),
    }),
  ),
});

export const ProductAgentAnswerSchema = z.object({
  message: z.string(),

  groups: z.array(ProductAnswerGroupSchema),

  resultGroups: z.array(ProductAnswerGroupSchema).optional(),

  consultation: ConsultationAgentResultSchema.nullable().default(null),

  consultationCompletion:
    ConsultationCompletionPresentationSchema.nullable().default(null),
});

export type ProductAgentAnswer = z.infer<typeof ProductAgentAnswerSchema>;
