import z from 'zod';

import { ProductItemSchema } from '@/src/product-consultation/application/agent/product-agent-result.schema';

import { ConsultationAgentResultSchema } from '@/src/product-consultation/application/consultation-agent/schemas/consultation-agent.schema';

import { ConsultationCompletionPresentationSchema } from '@/src/product-consultation/application/session/consultation-lifecycle.schema';

export const ProductAnswerGroupSchema = z.object({
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

  consultation: ConsultationAgentResultSchema.nullable().default(null),

  consultationCompletion:
    ConsultationCompletionPresentationSchema.nullable().default(null),
});

export type ProductAgentAnswer = z.infer<typeof ProductAgentAnswerSchema>;
