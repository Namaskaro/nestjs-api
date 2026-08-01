import { z } from 'zod';

export const AggregateSupportAnswerSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Общий финальный ответ пользователю на основании результатов всех воркеров',
    ),
});

export type AggregateSupportAnswer = z.infer<
  typeof AggregateSupportAnswerSchema
>;
