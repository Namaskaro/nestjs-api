import { z } from 'zod';

export const ProductItemSchema = z.object({
  id: z.string(),

  title: z.string(),

  price: z.string(),

  image: z.string(),
});

export type ProductItem = z.infer<typeof ProductItemSchema>;
