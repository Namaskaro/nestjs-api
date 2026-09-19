import { getCategoryProfile } from '../category-profiles';

import type { ProductAgentStateUpdate } from '../product-agent.state';

import {
  finishDeterministicTurn,
  type ConsultationRuntime,
} from './consultation-runtime';

import {
  buildComparisonMessage,
  finalizeComparisonPresentation,
  prepareComparisonPresentation,
} from './comparison-presentation';

import {
  emptyConsultationPatch,
  findProductNeed,
  type ProductTurnContext,
} from './product-turn.context';

export async function handleCompareTurn(
  turn: ProductTurnContext,

  runtime: ConsultationRuntime,
): Promise<ProductAgentStateUpdate> {
  const { state, context, comparisonSynthesis } = turn;

  const { core, products } = runtime;

  const reference = state.turn.products[0];

  if (!reference) {
    throw new Error('ProductAgent: COMPARE требует выбранные товары');
  }

  const needId = reference.needId;

  const need = findProductNeed(context, needId);

  const profile = getCategoryProfile(need.filters.type);

  const requested = state.turn.attributeIds.filter(
    (attributeId) =>
      !need.consultation.criteria.some(
        (criterion) => criterion.attributeId === attributeId,
      ) &&
      profile.attributes.some(
        (attribute) =>
          attribute.id === attributeId &&
          attribute.allowedOperators.includes('observe'),
      ),
  );

  if (requested.length) {
    core.updateMemory({
      needId,

      expectedRevision: 0,

      patch: {
        ...emptyConsultationPatch(),

        criteria: {
          update: [],

          remove: [],

          add: requested.map((attributeId) => ({
            attributeId,

            operator: 'observe',

            value: null,

            unit: null,

            required: false,

            importance: 'normal',

            sourceText: state.query.slice(0, 500),
          })),
        },
      },
    });
  }

  const comparisonView = core.compareProducts({
    needId,

    expectedRevision: core.referenceOptions(needId).memoryRevision,

    productIds: state.turn.products.map(
      (productReference) => productReference.productId,
    ),

    attributeIds: state.turn.attributeIds.length
      ? state.turn.attributeIds
      : null,
  });

  core.getProductDetails({
    needId,

    productIds: state.turn.products.map(
      (productReference) => productReference.productId,
    ),

    attributeIds: null,

    presentation: 'details',
  });

  const comparison = core
    .currentArtifacts()
    .comparisons.find(
      (artifact) => artifact.comparisonId === comparisonView.comparisonId,
    );

  if (!comparison) {
    throw new Error(
      'ProductAgent: ConsultationCore не создал comparison artifact',
    );
  }

  const prepared = prepareComparisonPresentation({
    comparison,

    products,

    need,

    profile,

    currentQuery: state.query,

    requestedAttributeIds: state.turn.attributeIds,
  });

  const synthesis = await comparisonSynthesis.summarizeComparison(
    prepared.synthesisInput,
  );

  const presentation = finalizeComparisonPresentation(prepared, synthesis);

  const message = buildComparisonMessage(presentation);

  context.comparison = [...state.turn.products];

  context.referenceOrder = [...state.turn.products];

  return finishDeterministicTurn(turn, runtime, message, {
    comparisonPresentation: presentation,
  });
}
