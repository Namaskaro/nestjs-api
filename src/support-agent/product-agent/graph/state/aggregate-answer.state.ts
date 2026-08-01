import { StateSchema } from '@langchain/langgraph';
import z from 'zod';
import { ProductAgentAnswerSchema } from '../../schemas/agreagte-answer.schema';

export const AggregateProductAgentAnswer = new StateSchema({
  finalAnswer: ProductAgentAnswerSchema.nullable().default(null),
});
