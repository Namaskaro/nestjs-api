import { z } from 'zod';

import { ClarificationTopicSchema } from './clarification-topic.schema';

export const ClarificationOptionSchema = z.object({
  id: z.string(),

  label: z.string(),
});

export type ClarificationOption = z.infer<typeof ClarificationOptionSchema>;

export const ClarificationNodeSchema = z.object({
  /**
   * topics:
   * пользователь должен выбрать категорию.
   *
   * questions:
   * пользователь должен выбрать готовый вопрос
   * или написать собственный.
   */
  kind: z.enum(['topics', 'questions', 'custom_input']),

  /**
   * Текст над кнопками.
   */
  question: z.string(),

  /**
   * Для kind: topics будет null.
   *
   * Для kind: questions будет выбранная тема.
   */
  topic: ClarificationTopicSchema.nullable(),

  /**
   * Кнопки для frontend.
   */
  options: z.array(ClarificationOptionSchema),
});

export type ClarificationNodeState = z.infer<typeof ClarificationNodeSchema>;
