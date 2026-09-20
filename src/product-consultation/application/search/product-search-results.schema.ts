import { z } from 'zod';
import { ProductNeedSchema } from '@/src/product-consultation/application/search/product-need.schema';
import { ProductItemSchema } from '@/src/product-consultation/application/agent/product-agent-result.schema';

export const ProductSearchResultSchema = z.object({
  productNeed: ProductNeedSchema,

  products: z.array(ProductItemSchema),
});

export type ProductSearchResult = z.infer<typeof ProductSearchResultSchema>;
