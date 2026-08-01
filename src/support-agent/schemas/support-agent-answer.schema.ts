import z from 'zod';
import { ProductAgentAnswerSchema } from '../product-agent/schemas/agreagte-answer.schema';

export const ProductSearchAnswerBlockSchema = z.object({
  worker: z.literal('product_search'),
  data: ProductAgentAnswerSchema,
});

export const SupportAgentAnswerBlockSchema = z.discriminatedUnion('worker', [
  ProductSearchAnswerBlockSchema,
]);

export const SupportAgentAnswerSchema = z.object({
  message: z.string(),
  blocks: z.array(SupportAgentAnswerBlockSchema).default(() => []),
});

export type SupportAgentAnswer = z.infer<typeof SupportAgentAnswerSchema>;

export type SupportAgentAnswerBlock = z.infer<
  typeof SupportAgentAnswerBlockSchema
>;
