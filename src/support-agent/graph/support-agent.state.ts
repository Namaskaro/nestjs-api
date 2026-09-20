// import { MessagesValue, ReducedValue, StateSchema } from '@langchain/langgraph';
// import { z } from 'zod';
// import {
//   HandoffRequestSchema,
//   HandoffSchema,
// } from '../agents/handoff-agent/schemas/handoff.schema';
// import { ProductNeedSchema } from '../agents/product-agent/schemas/product-need.schema';
// import { ClarificationTopicSchema } from '../schemas/clarification-topic.schema';
// import {
//   RequestRouterSchema,
//   RequestRouterWorkerSchema,
// } from '../schemas/request-router.schema';
// import {
//   SupportAgentAnswerBlockSchema,
//   SupportAgentAnswerSchema,
// } from '../schemas/support-agent-answer.schema';

// export const SupportAgentState = new StateSchema({
//   query: z.string(),

//   messages: MessagesValue,

//   preIntentRoute: z
//     .enum(['requestRouterNode', 'reject', 'clarificationTopic'])
//     .nullable()
//     .default(null),

//   rejectCount: z.number().int().nonnegative().default(0),

//   clarification: ClarificationTopicSchema.nullable().default(null),

//   requestRouter: RequestRouterSchema.nullable().default(null),

//   activeAgent: RequestRouterWorkerSchema.nullable().default(null),

//   // START ИЗМЕНЕНИЙ — PERSISTED PRODUCT SEARCH CONTEXT

//   currentProductNeed: ProductNeedSchema.nullable().default(null),

//   // END ИЗМЕНЕНИЙ — PERSISTED PRODUCT SEARCH CONTEXT

//   executionMode: z.enum(['single', 'multi']).nullable().default(null),

//   workerResults: new ReducedValue(
//     z.array(SupportAgentAnswerBlockSchema).default(() => []),
//     {
//       reducer: (currentResults, newResults) => {
//         if (newResults.length === 0) {
//           return [];
//         }

//         return currentResults.concat(newResults);
//       },
//     },
//   ),

//   handoffRequest: HandoffRequestSchema.nullable().default(null),

//   handoff: HandoffSchema.nullable().default(null),

//   answer: SupportAgentAnswerSchema.nullable().default(null),
// });

// export type SupportAgentStateType = typeof SupportAgentState.State;

// export type SupportAgentStateUpdate = typeof SupportAgentState.Update;

import { MessagesValue, ReducedValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

import {
  HandoffRequestSchema,
  HandoffSchema,
} from '../agents/handoff-agent/schemas/handoff.schema';

import { ClarificationTopicSchema } from '../schemas/clarification-topic.schema';

import {
  RequestRouterSchema,
  RequestRouterWorkerSchema,
} from '../schemas/request-router.schema';

import {
  SupportAgentAnswerBlockSchema,
  SupportAgentAnswerSchema,
} from '../schemas/support-agent-answer.schema';
import { ProductContextSchema } from '../../product-consultation/application/context/product-context.schema';

export const SupportAgentState = new StateSchema({
  query: z.string(),

  messages: MessagesValue,

  preIntentRoute: z
    .enum(['requestRouterNode', 'reject', 'clarificationTopic'])
    .nullable()
    .default(null),

  rejectCount: z.number().int().nonnegative().default(0),

  clarification: ClarificationTopicSchema.nullable().default(null),

  requestRouter: RequestRouterSchema.nullable().default(null),

  activeAgent: RequestRouterWorkerSchema.nullable().default(null),

  productContext: ProductContextSchema.nullable().default(null),

  executionMode: z.enum(['single', 'multi']).nullable().default(null),

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

  handoffRequest: HandoffRequestSchema.nullable().default(null),

  handoff: HandoffSchema.nullable().default(null),

  answer: SupportAgentAnswerSchema.nullable().default(null),
});

export type SupportAgentStateType = typeof SupportAgentState.State;

export type SupportAgentStateUpdate = typeof SupportAgentState.Update;
