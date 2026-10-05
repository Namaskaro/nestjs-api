import type { ProductLaneOutcome } from '../workspace/execute-product-lane';
import type { ProductActionPresentation } from '../agent/agreagte-answer.schema';

/** Read-only projection of successful actions; never consults a later snapshot. */
export function productActionPresentations(
  actions: ProductLaneOutcome['actions'],
): ProductActionPresentation[] {
  return actions.flatMap(
    ({ result }, actionOrdinal): ProductActionPresentation[] => {
      if (result.failed) return [];
      if (result.consultation?.productDetailsPresentation) {
        return [
          {
            actionOrdinal,
            kind: 'details',
            data: result.consultation.productDetailsPresentation,
          },
        ];
      }
      if (result.consultation?.comparisonPresentation) {
        return [
          {
            actionOrdinal,
            kind: 'comparison',
            data: result.consultation.comparisonPresentation,
          },
        ];
      }
      if (result.recommendationProductIds?.length) {
        return [
          {
            actionOrdinal,
            kind: 'recommendation',
            message: result.message,
            productIds: result.recommendationProductIds,
          },
        ];
      }
      return [];
    },
  );
}
