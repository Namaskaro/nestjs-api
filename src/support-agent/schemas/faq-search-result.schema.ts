import z from 'zod';

export const FaqSearchResultSchema = z.object({
  id: z.string(),
  code: z.string(),
  question: z.string(),
  answer: z.string(),
  similarity: z.number(),
});

export type FaqSearchResult = z.infer<typeof FaqSearchResultSchema>;
