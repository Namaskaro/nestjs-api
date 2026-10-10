import { z } from 'zod';

export const ClarificationTopicSchema = z.enum([
  'delivery',
  'product_search',
  'orders',
  'returns_claims',
  'payment',
  'discounts',
  'loyalty',
]);

export type ClarificationTopic = z.infer<typeof ClarificationTopicSchema>;
