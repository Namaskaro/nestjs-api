import { StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import {
  ProductContextSchema,
  ProductReferenceSchema,
} from '../../schemas/product-context.schema';
import { ProductActionSchema } from './schemas/product-planner-result.schema';
import { ProductSearchResultSchema } from './schemas/product-search-results.schema';
import { ConsultationAgentResultSchema } from './subagents/consultation-agent/schemas/consultation-agent.schema';

export const ProductTurnSchema = z.object({
  action: ProductActionSchema,
  products: z.array(ProductReferenceSchema).max(4),
  attributeIds: z.array(z.string()).max(8),
  reaction: z.enum(['like', 'dislike', 'mixed']).nullable(),
});

export type ProductTurn = z.infer<typeof ProductTurnSchema>;

export const ProductAgentState = new StateSchema({
  query: z.string().min(1),
  productContext: ProductContextSchema.nullable().default(null),
  turn: ProductTurnSchema.default(
    (): ProductTurn => ({
      action: 'CLARIFY',
      products: [],
      attributeIds: [],
      reaction: null,
    }),
  ),
  activeNeedIds: z
    .array(z.string().min(1))
    .max(5)
    .default(() => []),
  searchNeedIds: z
    .array(z.string().min(1))
    .max(5)
    .default(() => []),
  searchResults: z
    .array(
      ProductSearchResultSchema.extend({
        needId: z.string().min(1),
      }),
    )
    .max(5)
    .default(() => []),
  consultation: ConsultationAgentResultSchema.nullable().default(null),
  message: z.string().min(1).nullable().default(null),
});

export type ProductAgentStateType = typeof ProductAgentState.State;
export type ProductAgentStateUpdate = typeof ProductAgentState.Update;
