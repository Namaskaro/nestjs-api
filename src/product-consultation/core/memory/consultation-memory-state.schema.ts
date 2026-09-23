import { z } from 'zod';

import {
  ConsultationMemoryPatchSchema,
  ConsultationMemorySchema,
} from '../consultation-core.schema';

export const ConsultationMemoryStateSchema = z.object({
  version: z.literal(1),

  revision: z.number().int().nonnegative(),

  memory: ConsultationMemorySchema,
});

export const ConsultationMemoryCommandSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),

  patch: ConsultationMemoryPatchSchema,
});

export type ConsultationMemoryState = z.infer<
  typeof ConsultationMemoryStateSchema
>;

export type ConsultationMemoryCommand = z.infer<
  typeof ConsultationMemoryCommandSchema
>;
