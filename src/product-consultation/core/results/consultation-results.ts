import { randomUUID } from 'node:crypto';

import {
  SearchSpecSchema,
  type SearchSpec,
} from '../search/search-spec.schema';

import type {
  ConsultationAction,
  ProductSelection,
} from '../turn/consultation-turn.schema';

import {
  ConsultationResultsStateSchema,
  type ConsultationResultProduct,
  type ConsultationResultsState,
} from './consultation-results.schema';

export type ConsultationResultsIdFactory = () => string;

export type ResolvedProductSelection = {
  products: ConsultationResultProduct[];

  productIds: string[];

  resultId: string;
};

const MAX_COMPARE_PRODUCTS = 4;

const MAX_RECOMMENDATION_PRODUCTS = 5;

export function createConsultationResultsState(): ConsultationResultsState {
  return ConsultationResultsStateSchema.parse({
    version: 1,

    revision: 0,

    pendingSearch: null,

    active: null,
  });
}

/**
 * Начинает новый search execution.
 *
 * Новый execution автоматически делает
 * предыдущий pending execution устаревшим.
 *
 * Active выдача очищается сразу:
 * после изменения SearchSpec старые позиции
 * больше не должны считаться текущими.
 */
export function beginSearchExecution(
  currentRaw: ConsultationResultsState,

  searchRaw: SearchSpec,

  createId: ConsultationResultsIdFactory = randomUUID,
): {
  state: ConsultationResultsState;

  executionId: string;
} {
  const current = ConsultationResultsStateSchema.parse(currentRaw);

  const search = SearchSpecSchema.parse(searchRaw);

  const executionId = createId();

  const state = ConsultationResultsStateSchema.parse({
    version: 1,

    revision: current.revision + 1,

    pendingSearch: {
      executionId,

      search,
    },

    active: null,
  });

  return {
    state,

    executionId,
  };
}

/**
 * Принимает только результат того execution,
 * который всё ещё является текущим.
 *
 * Старый или запоздавший execution
 * не может заменить active выдачу.
 */
export function commitSearchExecution(
  currentRaw: ConsultationResultsState,

  executionId: string,

  products: readonly ConsultationResultProduct[],

  createId: ConsultationResultsIdFactory = randomUUID,
): ConsultationResultsState {
  const current = ConsultationResultsStateSchema.parse(currentRaw);

  if (
    current.pendingSearch === null ||
    current.pendingSearch.executionId !== executionId
  ) {
    throw new Error(
      `ConsultationResults: stale search execution ${executionId}.`,
    );
  }

  return ConsultationResultsStateSchema.parse({
    version: 1,

    revision: current.revision + 1,

    pendingSearch: null,

    active: {
      resultId: createId(),

      executionId,

      /**
       * Берём SearchSpec server-side
       * из pending execution.
       *
       * Search result сам не имеет права
       * прислать другой SearchSpec.
       */
      search: current.pendingSearch.search,

      products,
    },
  });
}

/**
 * Технический failure отличается
 * от успешного zero-result search.
 *
 * failure:
 * active = null
 *
 * successful zero-result:
 * active = snapshot с products=[]
 */
export function failSearchExecution(
  currentRaw: ConsultationResultsState,

  executionId: string,
): ConsultationResultsState {
  const current = ConsultationResultsStateSchema.parse(currentRaw);

  if (
    current.pendingSearch === null ||
    current.pendingSearch.executionId !== executionId
  ) {
    throw new Error(
      `ConsultationResults: stale search execution ${executionId}.`,
    );
  }

  return ConsultationResultsStateSchema.parse({
    version: 1,

    revision: current.revision + 1,

    pendingSearch: null,

    active: null,
  });
}

export function resolveProductSelection(
  stateRaw: ConsultationResultsState,

  selection: ProductSelection,
): ResolvedProductSelection {
  const state = ConsultationResultsStateSchema.parse(stateRaw);

  const snapshot = state.active;

  if (snapshot === null) {
    throw new Error('ConsultationResults: active search result is missing.');
  }

  if (snapshot.products.length === 0) {
    throw new Error('ConsultationResults: active product set is empty.');
  }

  if (selection.kind === 'active') {
    return {
      resultId: snapshot.resultId,

      products: [...snapshot.products],

      productIds: snapshot.products.map((product) => product.productId),
    };
  }

  const products = selection.positions.map((position) => {
    const product = snapshot.products[position - 1];

    if (!product) {
      throw new Error(
        `ConsultationResults: position ${position} is outside active product set.`,
      );
    }

    return product;
  });

  return {
    resultId: snapshot.resultId,

    products,

    productIds: products.map((product) => product.productId),
  };
}

export function resolveProductSelectionForAction(
  stateRaw: ConsultationResultsState,

  action: ConsultationAction,

  selection: ProductSelection,
): ResolvedProductSelection {
  const resolved = resolveProductSelection(stateRaw, selection);

  const count = resolved.products.length;

  switch (action) {
    case 'DETAILS': {
      if (count !== 1) {
        throw new Error(
          'ConsultationResults: DETAILS requires exactly one resolved product.',
        );
      }

      break;
    }

    case 'FEEDBACK': {
      if (count !== 1) {
        throw new Error(
          'ConsultationResults: FEEDBACK requires exactly one resolved product.',
        );
      }

      break;
    }

    case 'COMPARE': {
      if (count < 2 || count > MAX_COMPARE_PRODUCTS) {
        throw new Error(
          `ConsultationResults: COMPARE requires 2-${MAX_COMPARE_PRODUCTS} resolved products.`,
        );
      }

      break;
    }

    case 'RECOMMEND': {
      if (count < 1 || count > MAX_RECOMMENDATION_PRODUCTS) {
        throw new Error(
          `ConsultationResults: RECOMMEND requires 1-${MAX_RECOMMENDATION_PRODUCTS} resolved products.`,
        );
      }

      break;
    }

    default: {
      throw new Error(
        `ConsultationResults: action ${action} does not support product selection.`,
      );
    }
  }

  return resolved;
}
