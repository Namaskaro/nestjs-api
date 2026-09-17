import { z } from 'zod';
import { ProductSemanticRepresentationSchema } from './semantic-product-representation.schema';

export const ProductQdrantPayloadSchema = z.object({
  productId: z.string().uuid(),

  title: z.string(),
  description: z.string(),

  brandId: z.string().uuid(),
  brand: z.string(),

  categoryId: z.string().uuid(),
  category: z.string(),

  subcategoryId: z.string().uuid(),
  subcategory: z.string(),

  color: z.string().nullable(),

  // START CHANGES — EXACT COLOR KEY + RAW DETAILS В QDRANT PAYLOAD

  colorKey: z.string().nullable().default(null),
  details: z.array(z.string()).default([]),

  // END CHANGES — EXACT COLOR KEY + RAW DETAILS В QDRANT PAYLOAD

  price: z.number().nonnegative(),

  gender: z.string(),
  type: z.string(),
  sizes: z.array(z.string()),
  stock: z.number().int().nonnegative(),

  image: z.string(),
  inStock: z.boolean(),

  searchText: z.string(),

  semanticRepresentation: ProductSemanticRepresentationSchema,
});

export type ProductQdrantPayload = z.infer<typeof ProductQdrantPayloadSchema>;
