import z from 'zod';

export const NormalizeQuerySchema = z.object({
  queries: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      [
        'Массив независимых поисковых запросов.',
        'Каждый элемент должен описывать одну товарную потребность.',
      ].join(' '),
    ),
});

export type NormalizeQuery = z.infer<typeof NormalizeQuerySchema>;
