import { z } from 'zod';
import { ClarificationTopicSchema } from './clarification-topic.schema';

export const IntentRouterSchema = z.object({
  route: z
    .enum(['orchestrator', 'unsupported', 'clarification'])
    .describe(
      [
        'Выбери orchestrator, если запрос конкретный и относится к интернет-магазину.',
        'Выбери clarification, если запрос относится к магазину, но пользователь не указал конкретный вопрос.',
        'Выбери unsupported, если запрос не относится к магазину.',
      ].join(' '),
    ),
  clarificationTopic: ClarificationTopicSchema.nullable().describe(
    [
      'Определённая тема запроса.',
      'Верни null, если пользователь не указал даже общую тему',
      'или запрос не относится к интернет-магазину.',
    ].join(' '),
  ),
  reason: z.string().describe('Обхясни почему выбран именно этот маршрут'),
});

export type IntentRouterDecision = z.infer<typeof IntentRouterSchema>;
