import { z } from 'zod';

export const SupportAgentContextSchema = z.object({
  userId: z.string().trim().min(1),
});

export type SupportAgentContext = z.infer<typeof SupportAgentContextSchema>;
