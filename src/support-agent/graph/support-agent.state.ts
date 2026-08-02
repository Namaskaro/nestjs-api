import { IntentRouterSchema } from './../schemas/intent-router.schema';
import { MessagesValue, ReducedValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { OrchestratorSchema } from '../schemas/orchestrator.schema';

import { ClarificationTopicSchema } from '../schemas/clarification-topic.schema';
import {
  SupportAgentAnswerBlockSchema,
  SupportAgentAnswerSchema,
} from '../schemas/support-agent-answer.schema';

export const SupportAgentState = new StateSchema({
  query: z.string(),
  messages: MessagesValue,

  intentRouter: IntentRouterSchema.nullable().default(null),

  clarification: ClarificationTopicSchema.nullable().default(null),

  orchestrator: OrchestratorSchema.nullable().default(null),

  workerResults: new ReducedValue(
    z.array(SupportAgentAnswerBlockSchema).default(() => []),
    {
      reducer: (currentResults, newResults) => {
        if (newResults.length === 0) {
          return [];
        }

        return currentResults.concat(newResults);
      },
    },
  ),

  answer: SupportAgentAnswerSchema.nullable().default(null),
});

export type SupportAgentStateType = typeof SupportAgentState.State;
export type SupportAgentStateUpdate = typeof SupportAgentState.Update;
