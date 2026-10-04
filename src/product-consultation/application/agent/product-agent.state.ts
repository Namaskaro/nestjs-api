import { StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import {
  ProductWorkspaceSchema,
  createProductWorkspace,
} from '../workspace/product-workspace';
import { ProductWorkspacePlanSchema } from '../workspace/product-workspace-plan';
import { ProductAgentAnswerSchema } from './agreagte-answer.schema';

export const ProductAgentState = new StateSchema({
  query: z.string().min(1),
  conversationId: z.string().trim().min(1),
  requestId: z.string().trim().min(1).max(200),
  recentMessages: z
    .array(
      z
        .object({
          role: z.enum(['user', 'assistant']),
          text: z.string().trim().min(1).max(4000),
        })
        .strict(),
    )
    .max(6)
    .default(() => []),
  workspace: ProductWorkspaceSchema.default(createProductWorkspace),
  plan: ProductWorkspacePlanSchema.nullable().default(null),
  groups: ProductAgentAnswerSchema.shape.groups.default(() => []),
  consultation: ProductAgentAnswerSchema.shape.consultation,
  consultationCompletion: ProductAgentAnswerSchema.shape.consultationCompletion,
  handoffRequested: z.boolean().default(false),
  message: z.string().min(1).nullable().default(null),
});
export type ProductAgentStateType = typeof ProductAgentState.State;
export type ProductAgentStateUpdate = typeof ProductAgentState.Update;
