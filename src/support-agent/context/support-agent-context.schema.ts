import { z } from 'zod';
import type { ConsultationMemoryCandidate } from '@/src/consultation-memory/consultation-memory.types';

export const SupportAgentContextSchema = z.object({
  userId: z.string().trim().min(1),
  memorySourceMessageId: z.string().optional(),
  memoryCapture: z.custom<(candidate: ConsultationMemoryCandidate) => void>((value) => typeof value === 'function').optional(),
});

export type SupportAgentContext = z.infer<typeof SupportAgentContextSchema>;
