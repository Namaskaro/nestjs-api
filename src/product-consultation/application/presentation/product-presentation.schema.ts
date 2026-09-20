import { z } from 'zod';

import {
  AttributeKindSchema,
  FactStatusSchema,
} from '@/src/product-consultation/core/consultation-core.schema';

const IdSchema = z.string().trim().min(1).max(160);

const ProductPresentationValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

const ProductCatalogEntitySchema = z.object({
  id: IdSchema,
  name: z.string(),
});

export const ProductPresentationAttributeSchema = z.object({
  attributeId: IdSchema,

  label: z.string().trim().min(1),

  kind: AttributeKindSchema,

  status: FactStatusSchema,

  value: ProductPresentationValueSchema,

  unit: z.string().trim().min(1).nullable(),

  displayValue: z.string().nullable(),
});

export const ProductSnapshotSchema = z.object({
  id: IdSchema,

  title: z.string(),

  description: z.string(),

  productType: z.string(),

  profileId: IdSchema,

  price: z.string(),

  currency: z.string().nullable(),

  discount: z.string().nullable(),

  images: z.array(z.string()),

  availability: z.object({
    inStock: z.boolean().nullable(),

    stock: z.number().int().nonnegative().nullable(),
  }),

  brand: ProductCatalogEntitySchema.nullable(),

  category: ProductCatalogEntitySchema.nullable(),

  subcategory: ProductCatalogEntitySchema.nullable(),

  attributes: z.array(ProductPresentationAttributeSchema).max(128),
});

export const ProductDetailsPresentationSchema = z.object({
  needId: IdSchema,

  product: ProductSnapshotSchema,

  focusAttributeIds: z.array(IdSchema).max(32),
});

export type ProductPresentationAttribute = z.infer<
  typeof ProductPresentationAttributeSchema
>;

export type ProductSnapshot = z.infer<typeof ProductSnapshotSchema>;

export type ProductDetailsPresentation = z.infer<
  typeof ProductDetailsPresentationSchema
>;
