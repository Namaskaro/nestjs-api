import { readProductContext } from '@/src/product-consultation/application/context/product-context.schema';

import type { ProductAgentStateUpdate } from '@/src/product-consultation/application/agent/product-agent.state';

import {
  findProductNeed,
  type ProductTurnContext,
} from './product-turn.context';

export function handleSearchShowTurn({
  state,
  context,
}: ProductTurnContext): ProductAgentStateUpdate {
  for (const result of state.searchResults) {
    if (state.searchNeedIds.includes(result.needId)) {
      findProductNeed(context, result.needId).shownProducts = result.products;
    }
  }

  context.displayOrder = state.searchResults.flatMap((result) =>
    result.products.map((product) => ({
      needId: result.needId,

      productId: product.id,
    })),
  );

  context.referenceOrder = [...context.displayOrder];

  context.comparison = context.comparison.filter((reference) => {
    if (state.searchNeedIds.includes(reference.needId)) {
      return false;
    }

    return findProductNeed(context, reference.needId).shownProducts.some(
      (product) => product.id === reference.productId,
    );
  });

  if (context.comparison.length < 2) {
    context.comparison = [];
  }

  context.pendingClarification = null;

  const message = state.searchResults
    .map((result) => {
      const need = findProductNeed(context, result.needId);

      const label = [
        need.semanticQuery,

        need.filters.brand,

        need.filters.color,

        need.filters.size ? `размер ${need.filters.size}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      return result.products.length
        ? `По запросу «${label}» показано товаров: ${result.products.length}.`
        : `По запросу «${label}» подходящих товаров не найдено.`;
    })
    .join(' ');

  return {
    productContext: readProductContext(context),

    consultation: null,

    message,
  };
}
