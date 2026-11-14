import { z } from 'zod';
import type { ConsultationMemoryCandidate, ConsultationMemoryContinuation } from '@/src/consultation-memory/consultation-memory.types';

export const SupportAgentContextSchema = z.object({
  userId: z.string().trim().min(1),
  consultationAction: z.enum(['resume_unchanged', 'start_new']).optional(),
  memorySourceMessageId: z.string().optional(),
  memoryContinuation: z.custom<ConsultationMemoryContinuation>().optional(),
  memoryWitnesses: z.record(z.string(), z.object({ revision: z.number(), sourceMessageId: z.string().nullable() })).optional(),
  memoryUsed: z.custom<() => void>((value) => typeof value === 'function').optional(),
  memoryCapture: z.custom<(candidate: ConsultationMemoryCandidate) => void>((value) => typeof value === 'function').optional(),
});

export type SupportAgentContext = z.infer<typeof SupportAgentContextSchema>;
