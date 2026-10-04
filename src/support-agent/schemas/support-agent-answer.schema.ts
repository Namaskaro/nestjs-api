import { z } from 'zod';

import { ProductAgentAnswerSchema } from '@/src/product-consultation/application/agent/agreagte-answer.schema';

export const ProductSearchAnswerBlockSchema = z.object({
  worker: z.literal('product_search'),

  data: ProductAgentAnswerSchema,
});

export const OrderAnswerBlockSchema = z.object({
  worker: z.literal('order'),

  data: z.object({
    message: z.string(),
  }),
});

export const CustomerHelpAnswerBlockSchema = z.object({
  worker: z.literal('customer_help'),

  data: z.object({
    message: z.string(),
  }),
});

export const SupportAgentAnswerBlockSchema = z.discriminatedUnion('worker', [
  ProductSearchAnswerBlockSchema,

  OrderAnswerBlockSchema,

  CustomerHelpAnswerBlockSchema,
]);

const EmptyBlocksSchema = z
  .array(SupportAgentAnswerBlockSchema)
  .max(0)
  .default(() => []);

export const ProductAgentFinalAnswerSchema = ProductAgentAnswerSchema.extend({
  type: z.literal('product_agent'),

  blocks: EmptyBlocksSchema,
});

export const OrderAgentFinalAnswerSchema = z.object({
  type: z.literal('order_agent'),

  message: z.string(),

  blocks: EmptyBlocksSchema,
});

export const CustomerHelpFinalAnswerSchema = z.object({
  type: z.literal('customer_help'),

  message: z.string(),

  blocks: EmptyBlocksSchema,
});

export const AggregateFinalAnswerSchema = z.object({
  type: z.literal('aggregate'),

  message: z.string(),

  blocks: z.array(SupportAgentAnswerBlockSchema).min(1),
});

export const SupportMessageAnswerSchema = z.object({
  type: z.literal('message').default('message'),

  message: z.string(),

  blocks: EmptyBlocksSchema,
});

export const SupportAgentAnswerSchema = z.union([
  ProductAgentFinalAnswerSchema,

  OrderAgentFinalAnswerSchema,

  CustomerHelpFinalAnswerSchema,

  AggregateFinalAnswerSchema,

  SupportMessageAnswerSchema,
]);

export const SupportAgentMessageSchema = z.object({
  message: z.string(),
});

export type ProductAgentFinalAnswer = z.infer<
  typeof ProductAgentFinalAnswerSchema
>;

export type OrderAgentFinalAnswer = z.infer<typeof OrderAgentFinalAnswerSchema>;

export type CustomerHelpFinalAnswer = z.infer<
  typeof CustomerHelpFinalAnswerSchema
>;

export type AggregateFinalAnswer = z.infer<typeof AggregateFinalAnswerSchema>;

export type SupportAgentAnswer = z.infer<typeof SupportAgentAnswerSchema>;

export type SupportAgentAnswerBlock = z.infer<
  typeof SupportAgentAnswerBlockSchema
>;
