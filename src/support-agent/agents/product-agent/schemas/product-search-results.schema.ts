import { z } from 'zod';
import { ProductNeedSchema } from './product-need.schema';
import { ProductItemSchema } from './product-agent-result.schema';

export const ProductSearchResultSchema = z.object({
  productNeed: ProductNeedSchema,

  products: z.array(ProductItemSchema),
});

export type ProductSearchResult = z.infer<typeof ProductSearchResultSchema>;
