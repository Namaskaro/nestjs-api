import { z } from 'zod';
import { ProductAgentAnswerSchema } from '@/src/product-consultation/application/agent/agreagte-answer.schema';

export const ProductSearchAnswerBlockSchema = z.object({
  worker: z.literal('product_search'),

  data: ProductAgentAnswerSchema,
});

export const CustomerHelpAnswerBlockSchema = z.object({
  worker: z.literal('customer_help'),

  data: z.object({
    message: z.string(),
  }),
});

export const SupportAgentAnswerBlockSchema = z.discriminatedUnion('worker', [
  ProductSearchAnswerBlockSchema,
  CustomerHelpAnswerBlockSchema,
]);

const EmptyBlocksSchema = z
  .array(SupportAgentAnswerBlockSchema)
  .max(0)
  .default(() => []);

// НОВОЕ:
// Финальный ответ непосредственно от ProductAgent.
export const ProductAgentFinalAnswerSchema = ProductAgentAnswerSchema.extend({
  type: z.literal('product_agent'),

  blocks: EmptyBlocksSchema,
});

// НОВОЕ:
// Финальный ответ непосредственно от CustomerHelp.
export const CustomerHelpFinalAnswerSchema = z.object({
  type: z.literal('customer_help'),

  message: z.string(),

  blocks: EmptyBlocksSchema,
});

// НОВОЕ:
// Финальный ответ после объединения нескольких agents/workers.
export const AggregateFinalAnswerSchema = z.object({
  type: z.literal('aggregate'),

  message: z.string(),

  blocks: z.array(SupportAgentAnswerBlockSchema).min(1),
});

// НОВОЕ:
// Обычные системные ответы SupportAgent:
// reject, handoff-result и подобные сообщения.
export const SupportMessageAnswerSchema = z.object({
  type: z.literal('message').default('message'),

  message: z.string(),

  blocks: EmptyBlocksSchema,
});

// НОВОЕ:
// state.answer теперь может содержать разные типы финального ответа.
export const SupportAgentAnswerSchema = z.union([
  ProductAgentFinalAnswerSchema,
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

export type CustomerHelpFinalAnswer = z.infer<
  typeof CustomerHelpFinalAnswerSchema
>;

export type AggregateFinalAnswer = z.infer<typeof AggregateFinalAnswerSchema>;

export type SupportAgentAnswer = z.infer<typeof SupportAgentAnswerSchema>;

export type SupportAgentAnswerBlock = z.infer<
  typeof SupportAgentAnswerBlockSchema
>;
