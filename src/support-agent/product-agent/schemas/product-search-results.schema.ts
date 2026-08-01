import z from 'zod';
import { ProductItemSchema } from './product-agent-result.schema';

export const ProductSearchResultSchema = z.object({
  searchQuery: z.string(),
  products: z.array(ProductItemSchema),
});

export type ProductSearchResult = z.infer<typeof ProductSearchResultSchema>;
