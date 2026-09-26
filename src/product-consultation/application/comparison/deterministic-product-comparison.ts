import { ConsultationCore } from '../../core/consultation-core';

import type {
  AgentComparisonView,
  ProductDetails,
} from '../../core/consultation-core.schema';

import { CATEGORY_PROFILES } from '../../core/profiles';

import type { ProductConsultationState } from '../../core/state/consultation-state.schema';

export type DeterministicProductComparisonInput = {
  state: ProductConsultationState;

  productIds: readonly string[];

  products: readonly ProductDetails[];

  attributeIds?: readonly string[] | null;
};

/**
 * Временный compatibility bridge
 * к уже существующему deterministic
 * comparison engine.
 *
 * ВАЖНО:
 *
 * здесь НЕ возвращается старый Planner,
 * ProductNeed orchestration или legacy agent.
 *
 * Мы переиспользуем только чистое
 * вычисление сравнения ProductFacts.
 */
export function compareConsultationProducts(
  input: DeterministicProductComparisonInput,
): AgentComparisonView {
  const search = input.state.search;

  if (search === null) {
    throw new Error(
      'DeterministicProductComparison: active SearchSpec is required.',
    );
  }

  if (search.category === null) {
    throw new Error(
      'DeterministicProductComparison: categorized SearchSpec is required.',
    );
  }

  const profile = CATEGORY_PROFILES.find(
    (candidate) => candidate.id === search.category,
  );

  if (!profile) {
    throw new Error(
      `DeterministicProductComparison: unknown profile ${search.category}.`,
    );
  }

  const productIds = [...input.productIds];

  if (new Set(productIds).size !== productIds.length) {
    throw new Error('DeterministicProductComparison: duplicate productId.');
  }

  const productsById = new Map(
    input.products.map((product) => [product.id, product]),
  );

  const products = productIds.map((productId) => {
    const product = productsById.get(productId);

    if (!product) {
      throw new Error(
        `DeterministicProductComparison: product ${productId} is not loaded.`,
      );
    }

    if (product.profileId !== profile.id) {
      throw new Error(
        `DeterministicProductComparison: product ${productId} belongs to profile ${product.profileId}, expected ${profile.id}.`,
      );
    }

    return product;
  });

  const needId = 'current-consultation-task';

  /**
   * Старому deterministic Core
   * даём минимальный compatibility
   * snapshot.
   *
   * Никакого старого multi-need
   * orchestration здесь нет.
   */
  const core = new ConsultationCore({
    needs: [
      {
        needId,

        query: search.semanticIntent,

        preferences: [],

        profileId: profile.id,

        memory: input.state.memory.memory,

        /**
         * Hard constraints уже были
         * выполнены SearchPort-ом.
         *
         * Здесь нам нужен именно
         * deterministic fact comparison.
         */
        requirements: [],

        allowedProductIds: productIds,

        displayedProductIds: productIds,

        comparisonProductIds: productIds,
      },
    ],

    products,

    profiles: CATEGORY_PROFILES,

    budget: {
      comparisonProducts: 4,

      comparisonsPerTurn: 1,

      toolCallsPerTurn: 1,

      detailFactAttributes: 16,
    },
  });

  return core.compareProducts({
    needId,

    expectedRevision: 0,

    productIds,

    attributeIds: input.attributeIds ?? null,
  });
}
