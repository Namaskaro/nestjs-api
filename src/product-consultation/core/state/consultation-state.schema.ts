import { z } from 'zod';

import { ConsultationMemoryPatchSchema } from '../consultation-core.schema';

import {
  SearchSpecPatchSchema,
  SearchSpecSchema,
} from '../search/search-spec.schema';

import { ConsultationMemoryStateSchema } from '../memory/consultation-memory-state.schema';

/**
 * Authoritative состояние одной консультации.
 *
 * Консультация может существовать ещё ДО поиска:
 *
 * search = null
 *
 * Например:
 *
 * user: "Хочу что-нибудь подобрать"
 * assistant: "Для какого случая?"
 *
 * Поэтому наличие consultation state
 * больше не означает, что SearchSpec уже создан.
 */
export const ProductConsultationStateSchema = z
  .object({
    version: z.literal(1),

    search: SearchSpecSchema.nullable(),

    memory: ConsultationMemoryStateSchema,
  })
  .strict();

export const ConsultationStateDeltaSchema = z
  .object({
    /**
     * Только patch существующего SearchSpec.
     *
     * Новый независимый поиск создаётся
     * не через delta.search.
     */
    search: SearchSpecPatchSchema.optional(),

    memory: ConsultationMemoryPatchSchema.optional(),
  })
  .strict();

export type ProductConsultationState = z.infer<
  typeof ProductConsultationStateSchema
>;

export type ConsultationStateDelta = z.infer<
  typeof ConsultationStateDeltaSchema
>;
