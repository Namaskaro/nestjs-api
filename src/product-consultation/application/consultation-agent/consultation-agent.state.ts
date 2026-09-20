import { StateSchema } from '@langchain/langgraph';
import { ConsultationAgentResultSchema } from './schemas/consultation-agent.schema';

export const ConsultationAgentState = new StateSchema({
  consultationResult: ConsultationAgentResultSchema.nullable().default(null),
});

export type ConsultationAgentStateType = typeof ConsultationAgentState.State;
