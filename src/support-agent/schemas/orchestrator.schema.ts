import { z } from 'zod';

export const OrchestratorWorkerSchema = z.enum([
  'faqSearchWorker',
  'productSearch',
]);

export const OrchestratorSchema = z.object({
  workers: z
    .array(OrchestratorWorkerSchema)
    .min(1)
    .max(2)
    .refine((workers) => new Set(workers).size === workers.length, {
      message: 'Список воркеров не должен содержать дубликаты',
    }),

  reason: z
    .string()
    .describe('Кратко объясни, почему выбраны именно эти воркеры'),
});

export type OrchestratorWorker = z.infer<typeof OrchestratorWorkerSchema>;

export type OrchestratorDecision = z.infer<typeof OrchestratorSchema>;
