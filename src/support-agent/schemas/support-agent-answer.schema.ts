import { z } from 'zod';

import { ProductAgentAnswerSchema } from '../product-agent/schemas/agreagte-answer.schema';
import { FaqSearchResultSchema } from './faq-search-result.schema';

export const ProductSearchAnswerBlockSchema = z.object({
  worker: z.literal('product_search'),

  data: ProductAgentAnswerSchema,
});

export const FaqSearchAnswerBlockSchema = z.object({
  worker: z.literal('faq_worker'),

  data: z.array(FaqSearchResultSchema).default(() => []),
});

export const SupportAgentAnswerBlockSchema = z.discriminatedUnion('worker', [
  ProductSearchAnswerBlockSchema,
  FaqSearchAnswerBlockSchema,
]);

export const SupportAgentAnswerSchema = z.object({
  message: z.string(),

  blocks: z.array(SupportAgentAnswerBlockSchema).default(() => []),
});

export const SupportAgentMessageSchema = SupportAgentAnswerSchema.pick({
  message: true,
});

export type SupportAgentAnswer = z.infer<typeof SupportAgentAnswerSchema>;

export type SupportAgentAnswerBlock = z.infer<
  typeof SupportAgentAnswerBlockSchema
>;
