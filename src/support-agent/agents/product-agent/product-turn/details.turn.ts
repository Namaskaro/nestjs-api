import { getCategoryProfile } from '../category-profiles';

import type { ProductAgentStateUpdate } from '../product-agent.state';

import {
  finishDeterministicTurn,
  type ConsultationRuntime,
} from './consultation-runtime';

import { buildProductDetailsPresentation } from './product-presentation';

import type { ProductTurnContext } from './product-turn.context';

export function handleDetailsTurn(
  turn: ProductTurnContext,

  runtime: ConsultationRuntime,
): ProductAgentStateUpdate {
  const { state, context } = turn;

  const { core, products } = runtime;

  const reference = state.turn.products[0];

  if (!reference) {
    throw new Error('ProductAgent: DETAILS требует выбранный товар');
  }

  const product = products.find((item) => item.id === reference.productId);

  if (!product) {
    throw new Error(
      `ProductAgent: details product отсутствует в runtime: ${reference.productId}`,
    );
  }

  const focusAttributeIds = state.turn.attributeIds;

  core.getProductDetails({
    needId: reference.needId,

    productIds: [reference.productId],

    attributeIds: focusAttributeIds.length ? focusAttributeIds : null,

    presentation: 'details',
  });

  const profile = getCategoryProfile(product.profileId);

  const productDetailsPresentation = buildProductDetailsPresentation({
    needId: reference.needId,

    product,

    profile,

    focusAttributeIds,
  });

  context.referenceOrder = [reference];

  const message = `Подробная информация: ${product.title}.`;

  return finishDeterministicTurn(
    turn,

    runtime,

    message,

    {
      productDetailsPresentation,
    },
  );
}
