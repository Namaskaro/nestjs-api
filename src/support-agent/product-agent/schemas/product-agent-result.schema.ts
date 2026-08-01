import z from 'zod';

export const ProductItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  price: z.string(),
  image: z.string(),
  score: z.number(),
});

export const ProductAgentResultSchema = z.object({
  query: z.string(),
  normalizedQuery: z.string(),
  products: z.array(ProductItemSchema),
  answer: z.string(),
});

export type ProductItem = z.infer<typeof ProductItemSchema>;

export type ProductAgentResult = z.infer<typeof ProductAgentResultSchema>;
