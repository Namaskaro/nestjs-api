import type { ProductSelection } from '../turn/consultation-turn.schema';

import {
  ConsultationResultsStateSchema,
  type ConsultationResultProduct,
  type ConsultationResultsState,
} from './consultation-results.schema';

export type ResolvedProductSelection = {
  products: ConsultationResultProduct[];

  productIds: string[];
};

export function createConsultationResultsState(): ConsultationResultsState {
  return ConsultationResultsStateSchema.parse({
    version: 1,

    revision: 0,

    active: [],
  });
}

/**
 * Новый search всегда заменяет active result set.
 *
 * Это относится и к zero-result search:
 *
 * old active = [A, B, C]
 * new search = []
 *
 * после применения:
 * active = []
 *
 * Иначе ordinal references могли бы
 * случайно указывать на старые товары.
 */
export function replaceActiveResults(
  currentRaw: ConsultationResultsState,

  products: readonly ConsultationResultProduct[],
): ConsultationResultsState {
  const current = ConsultationResultsStateSchema.parse(currentRaw);

  return ConsultationResultsStateSchema.parse({
    version: 1,

    revision: current.revision + 1,

    active: products,
  });
}

/**
 * Превращает semantic selection interpreter-а
 * в реальные server-owned товары.
 *
 * LLM знает только:
 *
 * active
 *
 * или
 *
 * positions: [1, 2]
 *
 * Реальные productId берутся исключительно
 * из authoritative active result set.
 */
export function resolveProductSelection(
  stateRaw: ConsultationResultsState,

  selection: ProductSelection,
): ResolvedProductSelection {
  const state = ConsultationResultsStateSchema.parse(stateRaw);

  if (state.active.length === 0) {
    throw new Error('ConsultationResults: active product set is empty.');
  }

  if (selection.kind === 'active') {
    return {
      products: [...state.active],

      productIds: state.active.map((product) => product.productId),
    };
  }

  const products = selection.positions.map((position) => {
    const product = state.active[position - 1];

    if (!product) {
      throw new Error(
        `ConsultationResults: position ${position} is outside active product set.`,
      );
    }

    return product;
  });

  return {
    products,

    productIds: products.map((product) => product.productId),
  };
}
