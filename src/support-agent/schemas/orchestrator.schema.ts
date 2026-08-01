import { z } from 'zod';

/**
 * Воркеры, которые реально существуют в графе.
 *
 * По мере реализации новых воркеров этот enum
 * будет расширяться.
 */
export const OrchestratorWorkerSchema = z.enum([
  'faqSearchWorker',
  'productSearch',
]);

export const OrchestratorSchema = z.object({
  /**
   * Список воркеров, необходимых для обработки запроса.
   *
   * Пустой массив означает, что среди существующих
   * воркеров нет подходящего.
   */
  workers: z
    .array(OrchestratorWorkerSchema)
    .min(1)
    .describe(
      'Один или несколько воркеров, которые должны обработать запрос пользователя',
    ),

  /**
   * Объяснение решения.
   *
   * Используется для отладки и логирования.
   */
  reason: z
    .string()
    .describe('Кратко объясни, почему выбраны именно эти воркеры'),
});

export type OrchestratorWorker = z.infer<typeof OrchestratorWorkerSchema>;

export type OrchestratorDecision = z.infer<typeof OrchestratorSchema>;
