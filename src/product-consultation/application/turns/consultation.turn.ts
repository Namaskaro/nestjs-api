import { readProductContext } from '@/src/product-consultation/application/context/product-context.schema';
import type { AgentComparisonView } from '@/src/product-consultation/core/consultation-core.schema';
import type { ProductAgentStateUpdate } from '@/src/product-consultation/application/agent/product-agent.state';
import { ConsultationAgentInputSchema } from '@/src/product-consultation/application/consultation-agent/schemas/consultation-agent.schema';
import type { ConsultationRuntime } from './consultation-runtime';
import {
  findProductNeed,
  type ProductTurnContext,
} from '@/src/product-consultation/application/turns/product-turn.context';

export async function handleConsultationTurn(
  turn: ProductTurnContext,
  runtime: ConsultationRuntime,
  preparedComparisons?: AgentComparisonView[],
): Promise<ProductAgentStateUpdate> {
  const { state, context, consultant } = turn;

  const { core, bindings } = runtime;

  const input = ConsultationAgentInputSchema.parse({
    query: state.query,

    displayOrder: context.displayOrder,

    pendingClarification: context.pendingClarification,

    searches: state.searchResults.map((result, index) => {
      const initial = core.initialView(result.needId);

      const references = core.referenceOptions(result.needId);

      return {
        needId: initial.needId,

        query: initial.query,

        preferences: initial.preferences,

        profile: initial.profile,

        memory: initial.memory,

        memoryRevision: initial.memoryRevision,

        requirements: bindings[index].requirements,

        products: result.products.map(({ id, title, price }) => ({
          id,
          title,
          price,
        })),

        comparisonProductIds: initial.comparisonProductIds,

        facts: initial.products,

        reused: true,

        referenceOptions: references.options.map(({ id, ...option }) => option),
      };
    }),
  });

  const completed = await consultant.invoke(input, core, preparedComparisons);

  for (const update of completed.memories) {
    findProductNeed(context, update.needId).consultation = update.memory;
  }

  const consultation = completed.result;

  const latestComparison = consultation.comparisons.at(-1);

  if (latestComparison) {
    context.comparison = latestComparison.productIds.map((productId) => ({
      needId: latestComparison.needId,

      productId,
    }));
  }

  const decision = consultation.decisions.find(
    (item) => item.question !== null,
  );

  context.pendingClarification = decision
    ? {
        needId: decision.needId,

        kind: decision.nextAction === 'REFINE' ? 'refine' : 'alternatives',

        question: decision.question!,

        fields: decision.suggestedFields,

        proposal: decision.alternativePlan?.description ?? null,
      }
    : null;

  return {
    productContext: readProductContext(context),

    searchResults: [],

    consultation,

    message: [consultation.message, decision?.question]
      .filter(Boolean)
      .join('\n\n'),
  };
}
