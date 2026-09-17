import { z } from 'zod';

export const AssistantStatusSchema = z.enum([
  'IDLE',
  'THINKING',
  'SEARCHING_FAQ',
  'SEARCHING_PRODUCTS',
  'CHECKING_ORDER',
  'GENERATING_ANSWER',
]);

export type AssistantStatus = z.infer<typeof AssistantStatusSchema>;
