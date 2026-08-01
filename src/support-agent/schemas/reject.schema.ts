import z from 'zod';

export const RejectSchema = z.object({
  message: z.string().default(''),
});
