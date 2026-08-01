import { z } from 'zod';
import { ProductSemanticRepresentationSchema } from './semantic-product-representation.schema';

export const ProductQdrantPayloadSchema = z.object({
  productId: z.string().uuid(),

  title: z.string(),
  description: z.string(),

  brand: z.string(),
  category: z.string(),
  subcategory: z.string(),

  color: z.string(),
  price: z.string(),

  image: z.string(),
  inStock: z.boolean(),

  semanticRepresentation: ProductSemanticRepresentationSchema,
});

export type ProductQdrantPayload = z.infer<typeof ProductQdrantPayloadSchema>;

// const payload = ProductQdrantPayloadSchema.parse({
//   productId: product.id,
//   title: product.title,
//   description: product.description,
//   brand: product.brand.name,
//   category: product.subcategory.category.name,
//   subcategory: product.subcategory.name,
//   color: product.color,
//   price: product.price,
//   image: product.images[0] ?? '',
//   inStock: product.inStock,
//   semanticRepresentation,
// });
