import { IntentRouterSchema } from './../schemas/intent-router.schema';
import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { FaqSearchResultSchema } from '../schemas/faq-search-result.schema';
import { OrchestratorSchema } from '../schemas/orchestrator.schema';

import { ClarificationTopicSchema } from '../schemas/clarification-topic.schema';
import { SupportAgentAnswerSchema } from '../schemas/support-agent-answer.schema';
import { ProductAgentAnswerSchema } from '../product-agent/schemas/agreagte-answer.schema';

export const SupportAgentState = new StateSchema({
  query: z.string(),
  messages: MessagesValue,

  intentRouter: IntentRouterSchema.nullable().default(null),

  /**
   * Тема, которую пользователь выбрал
   * во время первого clarification interrupt.
   *
   * Может быть null, если:
   * - тема ещё не выбрана;
   * - clarification уже завершён.
   */
  clarification: ClarificationTopicSchema.nullable().default(null),

  faqResults: z.array(FaqSearchResultSchema).default(() => []),

  productSearchResult: ProductAgentAnswerSchema.nullable().default(null),

  orchestrator: OrchestratorSchema.nullable().default(null),

  answer: SupportAgentAnswerSchema.nullable().default(null),
});

export type SupportAgentStateType = typeof SupportAgentState.State;
export type SupportAgentStateUpdate = typeof SupportAgentState.Update;
