import { z } from 'zod';

export const ClarificationTopicSchema = z.enum([
  'delivery',
  'product_search',
  'orders',
  'returns_claims',
  'payment',
]);

export type ClarificationTopic = z.infer<typeof ClarificationTopicSchema>;
