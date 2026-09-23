import {
  applyConsultationMemoryPatch,
  createConsultationMemoryState,
  type ConsultationMemoryIdFactory,
} from '../memory/consultation-memory';

import { applySearchSpecPatch, createSearchSpec } from '../search/search-spec';

import type { SearchSpecDraft } from '../search/search-spec.schema';

import {
  ConsultationStateDeltaSchema,
  ProductConsultationStateSchema,
  type ConsultationStateDelta,
  type ProductConsultationState,
} from './consultation-state.schema';

export function createEmptyProductConsultationState(): ProductConsultationState {
  return ProductConsultationStateSchema.parse({
    version: 1,

    search: null,

    memory: createConsultationMemoryState(),
  });
}

/**
 * Convenience для случаев,
 * когда консультация сразу начинается с поиска.
 */
export function createProductConsultationState(
  search: SearchSpecDraft,
): ProductConsultationState {
  return ProductConsultationStateSchema.parse({
    version: 1,

    search: createSearchSpec(search),

    memory: createConsultationMemoryState(),
  });
}

/**
 * Полностью заменяет текущий SearchSpec.
 *
 * Это НЕ patch.
 *
 * Используется для нового независимого SEARCH.
 *
 * resetMemory=true:
 * старая task-scoped memory не переносится
 * в новую задачу автоматически.
 *
 * resetMemory=false:
 * используется при первом поиске после
 * предварительного CLARIFY — уже собранные
 * сведения этой же задачи сохраняются.
 */
export function replaceProductConsultationSearch(
  currentRaw: ProductConsultationState,

  search: SearchSpecDraft,

  options: {
    resetMemory: boolean;
  },
): ProductConsultationState {
  const current = ProductConsultationStateSchema.parse(currentRaw);

  return ProductConsultationStateSchema.parse({
    version: 1,

    search: createSearchSpec(search),

    memory: options.resetMemory
      ? createConsultationMemoryState()
      : current.memory,
  });
}

/**
 * Patch существующего state.
 *
 * delta.search нельзя применить,
 * если SearchSpec ещё не существует.
 */
export function applyConsultationStateDelta(
  currentRaw: ProductConsultationState,

  deltaRaw: ConsultationStateDelta,

  createId?: ConsultationMemoryIdFactory,
): ProductConsultationState {
  const current = ProductConsultationStateSchema.parse(currentRaw);

  const delta = ConsultationStateDeltaSchema.parse(deltaRaw);

  let search = current.search;

  if (delta.search !== undefined) {
    if (current.search === null) {
      throw new Error(
        'ProductConsultationState: cannot patch SearchSpec before search starts.',
      );
    }

    search = applySearchSpecPatch(current.search, delta.search);
  }

  const memory =
    delta.memory !== undefined
      ? applyConsultationMemoryPatch(
          current.memory,

          {
            expectedRevision: current.memory.revision,

            patch: delta.memory,
          },

          createId,
        )
      : current.memory;

  return ProductConsultationStateSchema.parse({
    version: 1,

    search,

    memory,
  });
}
