import { z } from 'zod';

import {
  ClarificationCustomQuestionResumeSchema,
  ClarificationQuestionSelectedResumeSchema,
  ClarificationTopicResumeSchema,
} from './clarification-resume.schema';

import { OperatorOfferResumeSchema } from '../agents/handoff-agent/schemas/operator-offer.schema';

// START ИЗМЕНЕНИЙ — ЕДИНЫЙ RESUME ДЛЯ SUPPORT GRAPH
export const SupportAgentResumeSchema = z.union([
  ClarificationTopicResumeSchema,

  ClarificationQuestionSelectedResumeSchema,

  ClarificationCustomQuestionResumeSchema,

  OperatorOfferResumeSchema,
]);

export type SupportAgentResumeValue = z.infer<typeof SupportAgentResumeSchema>;
// END ИЗМЕНЕНИЙ — ЕДИНЫЙ RESUME ДЛЯ SUPPORT GRAPH
