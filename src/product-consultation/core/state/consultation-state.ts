import {
  applyConsultationMemoryPatch,
  createConsultationMemoryState,
  type ConsultationMemoryIdFactory,
} from '../memory/consultation-memory';

import { applySearchSpecPatch, createSearchSpec } from '../search/search-spec';

import type { SearchSpec } from '../search/search-spec.schema';

import {
  ConsultationStateDeltaSchema,
  ProductConsultationStateSchema,
  type ConsultationStateDelta,
  type ProductConsultationState,
} from './consultation-state.schema';

export function createProductConsultationState(
  search: Omit<SearchSpec, 'version'>,
): ProductConsultationState {
  return ProductConsultationStateSchema.parse({
    version: 1,

    search: createSearchSpec(search),

    memory: createConsultationMemoryState(),
  });
}

/**
 * Единственная deterministic точка,
 * где semantic turn delta превращается
 * в новый consultation state.
 *
 * Важное правило:
 *
 * отсутствующая секция delta
 * вообще не изменяет соответствующий state.
 */
export function applyConsultationStateDelta(
  currentRaw: ProductConsultationState,

  deltaRaw: ConsultationStateDelta,

  createId?: ConsultationMemoryIdFactory,
): ProductConsultationState {
  const current = ProductConsultationStateSchema.parse(currentRaw);

  const delta = ConsultationStateDeltaSchema.parse(deltaRaw);

  const search =
    delta.search !== undefined
      ? applySearchSpecPatch(current.search, delta.search)
      : current.search;

  /**
   * Revision принадлежит Core.
   *
   * Внешний interpreter её не задаёт.
   */
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
