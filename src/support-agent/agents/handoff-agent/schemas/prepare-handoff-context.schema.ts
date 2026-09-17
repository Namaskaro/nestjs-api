import { z } from 'zod';
import { HandoffContextSchema } from './handoff.schema';

export const PrepareHandoffContextSchema = z.object({
  summary: z
    .string()
    .describe(
      'Краткая выжимка обращения, которую оператор сможет быстро прочитать',
    ),

  context: HandoffContextSchema,
});

export type PrepareHandoffContext = z.infer<typeof PrepareHandoffContextSchema>;
