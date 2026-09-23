import { z } from 'zod';

import { ConsultationMemoryPatchSchema } from '../consultation-core.schema';

import {
  SearchSpecPatchSchema,
  SearchSpecSchema,
} from '../search/search-spec.schema';

import { ConsultationMemoryStateSchema } from '../memory/consultation-memory-state.schema';

/**
 * Новое persistent состояние одной
 * товарной консультации.
 *
 * Пока здесь намеренно только фундамент:
 *
 * - что ищем;
 * - зачем / по каким критериям выбираем.
 *
 * Results, references, actions и presentation
 * будут отдельными bounded concepts.
 */
export const ProductConsultationStateSchema = z
  .object({
    version: z.literal(1),

    search: SearchSpecSchema,

    memory: ConsultationMemoryStateSchema,
  })
  .strict();

/**
 * Semantic delta одного пользовательского turn.
 *
 * Здесь НЕТ:
 *
 * - expectedRevision;
 * - needId;
 * - server-generated IDs;
 * - полного нового state.
 *
 * Внешний interpreter сообщает только,
 * ЧТО изменилось.
 *
 * Core сам применяет изменение
 * к authoritative current state.
 */
export const ConsultationStateDeltaSchema = z
  .object({
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
