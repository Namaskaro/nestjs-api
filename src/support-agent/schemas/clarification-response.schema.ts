import { z } from 'zod';

import { ClarificationTopicSchema } from './clarification-topic.schema';

export const OrderCancellationCardSchema = z.object({
  number: z.string().min(1),

  status: z.enum([
    'DRAFT',
    'PENDING_PAYMENT',
    'PAID',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
  ]),

  finalAmount: z.number().nonnegative(),

  currency: z.literal('RUB'),

  items: z.array(
    z.object({
      productId: z.string(),

      title: z.string(),

      image: z.string().nullable(),

      size: z.string().nullable(),

      quantity: z.number().int().positive(),
    }),
  ),
});

export type OrderCancellationCard = z.infer<typeof OrderCancellationCardSchema>;

export const ClarificationOptionSchema = z.object({
  id: z.string().min(1),

  label: z.string().min(1),

  // Используется только при подтверждении
  // отмены заказа.
  //
  // Остальные clarification options
  // не обязаны содержать это поле.
  order: OrderCancellationCardSchema.optional(),
});

export type ClarificationOption = z.infer<typeof ClarificationOptionSchema>;

export const ClarificationNodeSchema = z.object({
  kind: z.enum(['topics', 'questions', 'custom_input']),

  question: z.string(),

  topic: ClarificationTopicSchema.nullable(),

  options: z.array(ClarificationOptionSchema),
});

export type ClarificationNodeState = z.infer<typeof ClarificationNodeSchema>;
