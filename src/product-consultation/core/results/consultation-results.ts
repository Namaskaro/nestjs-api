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
  type SearchResultSnapshot,
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

    lastConfirmed: null,
  });
}

/**
 * Новый search execution.
 *
 * active очищается немедленно:
 *
 * новый SearchSpec уже существует,
 * поэтому старая выдача не является
 * выдачей нового запроса.
 *
 * Но lastConfirmed сохраняется.
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

    /**
     * Старый result больше
     * не является current.
     */
    active: null,

    /**
     * Но последний подтверждённый
     * snapshot не теряем.
     */
    lastConfirmed: current.lastConfirmed,
  });

  return {
    state,

    executionId,
  };
}

/**
 * Commit успешного search.
 *
 * Даже products=[] является
 * успешно подтверждённым snapshot.
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

  const snapshot = SearchResultSnapshot({
    resultId: createId(),

    executionId,

    search: current.pendingSearch.search,

    products,
  });

  return ConsultationResultsStateSchema.parse({
    version: 1,

    revision: current.revision + 1,

    pendingSearch: null,

    active: snapshot,

    /**
     * Новый успешный search
     * становится последним
     * подтверждённым snapshot.
     */
    lastConfirmed: snapshot,
  });
}

function SearchResultSnapshot(input: {
  resultId: string;

  executionId: string;

  search: SearchSpec;

  products: readonly ConsultationResultProduct[];
}): SearchResultSnapshot {
  return {
    resultId: input.resultId,

    executionId: input.executionId,

    search: input.search,

    products: [...input.products],
  };
}

/**
 * Technical failure.
 *
 * В отличие от successful zero-result:
 *
 * active = null.
 *
 * Но lastConfirmed сохраняется.
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

    /**
     * Не притворяемся,
     * что старая выдача является
     * результатом failed search.
     */
    active: null,

    /**
     * Но пользователь реально
     * видел этот snapshot раньше.
     */
    lastConfirmed: current.lastConfirmed,
  });
}

function resolveSelectionInsideSnapshot(
  snapshot: SearchResultSnapshot,

  selection: ProductSelection,
): ResolvedProductSelection {
  if (snapshot.products.length === 0) {
    throw new Error('ConsultationResults: product set is empty.');
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
        `ConsultationResults: position ${position} is outside product set.`,
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

/**
 * Обычный resolver:
 * работает ТОЛЬКО с current active.
 */
export function resolveProductSelection(
  stateRaw: ConsultationResultsState,

  selection: ProductSelection,
): ResolvedProductSelection {
  const state = ConsultationResultsStateSchema.parse(stateRaw);

  if (state.active === null) {
    throw new Error('ConsultationResults: active search result is missing.');
  }

  return resolveSelectionInsideSnapshot(state.active, selection);
}

/**
 * Явное разрешение ссылки
 * относительно server-owned resultId.
 *
 * Используется Public Turn Boundary,
 * потому что она знает,
 * какой snapshot видел Consultant.
 *
 * Может разрешить:
 *
 * - current active;
 * - lastConfirmed после technical failure.
 *
 * Но не произвольную историю.
 */
export function resolveProductSelectionFromResult(
  stateRaw: ConsultationResultsState,

  resultId: string,

  selection: ProductSelection,
): ResolvedProductSelection {
  const state = ConsultationResultsStateSchema.parse(stateRaw);

  let snapshot: SearchResultSnapshot | null = null;

  if (state.active?.resultId === resultId) {
    snapshot = state.active;
  } else if (state.lastConfirmed?.resultId === resultId) {
    snapshot = state.lastConfirmed;
  }

  if (snapshot === null) {
    throw new Error(
      `ConsultationResults: result snapshot ${resultId} is not available.`,
    );
  }

  return resolveSelectionInsideSnapshot(snapshot, selection);
}

function assertActionSelectionCount(
  action: ConsultationAction,

  resolved: ResolvedProductSelection,
): void {
  const count = resolved.products.length;

  switch (action) {
    case 'DETAILS': {
      if (count !== 1) {
        throw new Error(
          'ConsultationResults: DETAILS requires exactly one resolved product.',
        );
      }

      return;
    }

    case 'FEEDBACK': {
      if (count !== 1) {
        throw new Error(
          'ConsultationResults: FEEDBACK requires exactly one resolved product.',
        );
      }

      return;
    }

    case 'COMPARE': {
      if (count < 2 || count > MAX_COMPARE_PRODUCTS) {
        throw new Error(
          `ConsultationResults: COMPARE requires 2-${MAX_COMPARE_PRODUCTS} resolved products.`,
        );
      }

      return;
    }

    case 'RECOMMEND': {
      if (count < 1 || count > MAX_RECOMMENDATION_PRODUCTS) {
        throw new Error(
          `ConsultationResults: RECOMMEND requires 1-${MAX_RECOMMENDATION_PRODUCTS} resolved products.`,
        );
      }

      return;
    }

    default: {
      throw new Error(
        `ConsultationResults: action ${action} does not support product selection.`,
      );
    }
  }
}

export function resolveProductSelectionForAction(
  stateRaw: ConsultationResultsState,

  action: ConsultationAction,

  selection: ProductSelection,
): ResolvedProductSelection {
  const resolved = resolveProductSelection(stateRaw, selection);

  assertActionSelectionCount(action, resolved);

  return resolved;
}

/**
 * Та же action-specific validation,
 * но относительно явно указанного
 * server-owned resultId.
 */
export function resolveProductSelectionForActionFromResult(
  stateRaw: ConsultationResultsState,

  action: ConsultationAction,

  resultId: string,

  selection: ProductSelection,
): ResolvedProductSelection {
  const resolved = resolveProductSelectionFromResult(
    stateRaw,
    resultId,
    selection,
  );

  assertActionSelectionCount(action, resolved);

  return resolved;
}
