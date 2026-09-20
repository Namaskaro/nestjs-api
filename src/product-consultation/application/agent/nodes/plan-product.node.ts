import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '../../../../ai/ai.service';

import { readProductContext } from '../../../../product-consultation/application/context/product-context.schema';

import { getCategoryProfile } from '../../../../product-consultation/core/profiles';

import { ProductAgentService } from '../product-agent.service';

import { ProductAgentState } from '../../../../product-consultation/application/agent/product-agent.state';

import {
  applyProductPlan,
  brandKey,
} from '../../../../product-consultation/application/planner/product-plan';

import { productPlannerPrompt } from '../../../../product-consultation/application/planner/product-agent.prompt';

import { ProductPlannerResultSchema } from '../../../../product-consultation/application/planner/product-planner-result.schema';

export function createPlanProductNode(
  aiService: AiService,
  productAgentService: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  const planner = aiService
    .getChatModel('yandex')
    .withStructuredOutput(ProductPlannerResultSchema, {
      name: 'plan_product_request',

      includeRaw: true,
    });

  return async (state) => {
    const context = readProductContext(state.productContext);

    const indexOf = (needId: string) =>
      context.needs.findIndex((need) => need.needId === needId) + 1;

    const presentation = (refs: typeof context.displayOrder) =>
      refs.map((ref, index) => ({
        position: index + 1,

        needIndex: indexOf(ref.needId),

        title:
          context.needs
            .find((need) => need.needId === ref.needId)
            ?.shownProducts.find((product) => product.id === ref.productId)
            ?.title ?? '',
      }));

    const activeReferences = context.referenceOrder.length
      ? context.referenceOrder
      : context.comparison.length
      ? context.comparison
      : context.displayOrder;

    const response = await planner.invoke([
      new SystemMessage(productPlannerPrompt),

      new HumanMessage(
        JSON.stringify({
          query: state.query,

          needs: context.needs.map((need, index) => ({
            needIndex: index + 1,

            query: need.semanticQuery,

            filters: need.filters,

            preferences: need.preferences,

            productsCount: need.shownProducts.length,

            goals: need.consultation.goals.slice(0, 4).map((goal) => goal.text),

            attributes: getCategoryProfile(need.filters.type).attributes.map(
              (attribute) => ({
                id: attribute.id,

                label: attribute.label,
              }),
            ),
          })),

          active: presentation(activeReferences),

          display: presentation(context.displayOrder),

          comparison: presentation(context.comparison),

          consultationSession: context.consultationSession
            ? {
                status: context.consultationSession.status,

                needIds: context.consultationSession.needIds.map(indexOf),
              }
            : null,

          pendingClarification: context.pendingClarification
            ? {
                ...context.pendingClarification,

                needId: undefined,

                needIndex: context.pendingClarification.needId
                  ? indexOf(context.pendingClarification.needId)
                  : null,
              }
            : null,
        }),
      ),
    ]);

    const parsed = ProductPlannerResultSchema.safeParse(response.parsed);

    const values = parsed.success
      ? [
          ...new Set(
            parsed.data.updates
              .filter((patch) =>
                ['candidate', 'required'].includes(patch.brandMode),
              )
              .flatMap((patch) => (patch.brandValue ? [patch.brandValue] : [])),
          ),
        ]
      : [];

    const brands = new Map(
      await Promise.all(
        values.map(
          async (value) =>
            [
              brandKey(value),

              await productAgentService.resolveBrandName(value),
            ] as const,
        ),
      ),
    );

    return {
      ...applyProductPlan(
        context,

        parsed.success ? parsed.data : null,

        state.query,

        brands,
      ),

      searchResults: [],

      consultation: null,
    };
  };
}
