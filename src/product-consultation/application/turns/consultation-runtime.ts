import { readProductContext } from '../context/product-context.schema';

import { CATEGORY_PROFILES, getCategoryProfile } from '../../core/profiles';

import {
  ConsultationCore,
  type ConsultationNeedSnapshot,
} from '../../core/consultation-core';

import type { ProductDetails } from '../consultation-core/consultation-core.schema';

import type { ProductAgentService } from '../../../support-agent/agents/product-agent/product-agent.service';

import type { ProductAgentStateUpdate } from '../../../support-agent/agents/product-agent/product-agent.state';

import type { ComparisonPresentation } from '../../../support-agent/agents/product-agent/schemas/comparison-presentation.schema';

import type { ProductDetailsPresentation } from '../../../support-agent/agents/product-agent/schemas/product-presentation.schema';

import { ConsultationAgentResultSchema } from '../subagents/consultation-agent/schemas/consultation-agent.schema';

import {
  findProductNeed,
  type ProductTurnContext,
} from '../../../support-agent/agents/product-agent/product-turn/product-turn.context';

type ConsultationBinding = Awaited<
  ReturnType<ProductAgentService['getConsultationBinding']>
>;

export type ConsultationRuntime = {
  products: ProductDetails[];

  bindings: ConsultationBinding[];

  snapshots: ConsultationNeedSnapshot[];

  core: ConsultationCore;
};

export type ConsultationRuntimeResult =
  | {
      ok: true;

      runtime: ConsultationRuntime;
    }
  | {
      ok: false;

      update: ProductAgentStateUpdate;
    };

export async function prepareConsultationRuntime(
  turn: ProductTurnContext,
): Promise<ConsultationRuntimeResult> {
  const { state, context, productAgentService } = turn;

  const feedbackOnly = state.turn.action === 'FEEDBACK';

  const ids = [
    ...new Set(
      state.searchResults.flatMap((result) =>
        result.products.map((product) => product.id),
      ),
    ),
  ];

  const [products, bindings] = await Promise.all([
    feedbackOnly
      ? Promise.resolve([])
      : productAgentService.getProductDetails(ids),

    Promise.all(
      state.searchResults.map((result) =>
        feedbackOnly
          ? Promise.resolve({
              profileId: getCategoryProfile(result.productNeed.filters.type).id,

              requirements: [],
            })
          : productAgentService.getConsultationBinding(result.productNeed),
      ),
    ),
  ]);

  const loaded = new Set(products.map((product) => product.id));

  if (
    !feedbackOnly &&
    state.turn.products.some((reference) => !loaded.has(reference.productId))
  ) {
    const message =
      'Один из выбранных товаров больше не доступен в каталоге. Какой подбор обновить?';

    context.pendingClarification = {
      needId: null,

      kind: 'clarification',

      question: message,

      fields: [],

      proposal: null,
    };

    return {
      ok: false,

      update: {
        productContext: context,

        searchResults: [],

        consultation: null,

        message,
      },
    };
  }

  const snapshots: ConsultationNeedSnapshot[] = state.searchResults.map(
    (result, index) => {
      const need = findProductNeed(context, result.needId);

      const allowedProductIds = result.products.map((product) => product.id);

      return {
        needId: need.needId,

        query: need.semanticQuery,

        preferences: need.preferences,

        profileId: bindings[index].profileId,

        memory: need.consultation,

        requirements: bindings[index].requirements,

        allowedProductIds,

        displayedProductIds: allowedProductIds,

        comparisonProductIds: context.comparison
          .filter(
            (reference) =>
              reference.needId === need.needId &&
              allowedProductIds.includes(reference.productId),
          )
          .map((reference) => reference.productId),
      };
    },
  );

  const core = new ConsultationCore({
    needs: snapshots,

    products,

    profiles: CATEGORY_PROFILES,
  });

  return {
    ok: true,

    runtime: {
      products,

      bindings,

      snapshots,

      core,
    },
  };
}

type FinishDeterministicTurnOptions = {
  comparisonPresentation?: ComparisonPresentation | null;

  productDetailsPresentation?: ProductDetailsPresentation | null;
};

export function finishDeterministicTurn(
  turn: ProductTurnContext,

  runtime: ConsultationRuntime,

  message: string,

  options: FinishDeterministicTurnOptions = {},
): ProductAgentStateUpdate {
  const { context } = turn;

  const { core, snapshots } = runtime;

  const artifacts = core.currentArtifacts();

  const consultation = ConsultationAgentResultSchema.parse({
    message,

    decisions: snapshots.map((need) => ({
      needId: need.needId,

      query: need.query,

      nextAction: 'SHOW_RESULTS',

      suggestedFields: [],

      alternativePlan: null,

      question: null,
    })),

    recommendations: [],

    ...artifacts,

    comparisonPresentation: options.comparisonPresentation ?? null,

    productDetailsPresentation: options.productDetailsPresentation ?? null,
  });

  core.seal();

  for (const update of core.committedMemories()) {
    findProductNeed(context, update.needId).consultation = update.memory;
  }

  context.pendingClarification = null;

  return {
    productContext: readProductContext(context),

    searchResults: [],

    consultation,

    message,
  };
}
