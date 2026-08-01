import { z } from 'zod';

import { ClarificationTopicSchema } from './clarification-topic.schema';

export const ClarificationTopicResumeSchema = z.object({
  kind: z.literal('topic_selected'),

  topic: ClarificationTopicSchema,
});

export type ClarificationTopicResume = z.infer<
  typeof ClarificationTopicResumeSchema
>;

export const ClarificationQuestionSelectedResumeSchema = z.object({
  kind: z.literal('question_selected'),

  questionId: z.string().min(1),
});

export type ClarificationQuestionSelectedResume = z.infer<
  typeof ClarificationQuestionSelectedResumeSchema
>;

export const ClarificationCustomQuestionResumeSchema = z.object({
  kind: z.literal('custom_question'),

  text: z.string().trim().min(1),
});

export type ClarificationCustomQuestionResume = z.infer<
  typeof ClarificationCustomQuestionResumeSchema
>;

export const ClarificationQuestionResumeSchema = z.discriminatedUnion('kind', [
  ClarificationQuestionSelectedResumeSchema,

  ClarificationCustomQuestionResumeSchema,
]);

export type ClarificationQuestionResume = z.infer<
  typeof ClarificationQuestionResumeSchema
>;

export type ClarificationResumeValue =
  | ClarificationTopicResume
  | ClarificationQuestionResume;
