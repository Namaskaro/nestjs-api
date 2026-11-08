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

export const ProductReviewExperienceSchema = z.object({
  averageRating: z.number().min(1).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  positiveCount: z.number().int().nonnegative(),
  neutralCount: z.number().int().nonnegative(),
  negativeCount: z.number().int().nonnegative(),
  positivePercent: z.number().min(0).max(100),
  summary: z
    .object({
      positiveImpressions: z.array(z.string()),
      negativeImpressions: z.array(z.string()),
      summary: z.string(),
      generatedAt: z.string().datetime(),
      sourceReviewCount: z.number().int().min(10),
    })
    .nullable(),
});

export const ProductReviewAnswerSchema = z.object({
  message: z.string().min(1).max(2400),
  sources: z
    .array(
      z.object({
        productId: z.string().uuid(),
        reviewId: z.string().uuid(),
        publicationId: z.string().uuid(),
        sourceId: z.string().uuid(),
        sourceKind: z.enum(['review', 'addendum']),
        text: z.string().min(1).max(4000),
        publishedAt: z.string().datetime(),
        authorName: z.string(),
      }),
    )
    .max(4),
});

export type ProductReviewExperience = z.infer<
  typeof ProductReviewExperienceSchema
>;
export type ProductReviewAnswer = z.infer<typeof ProductReviewAnswerSchema>;

export const ProductDetailsPresentationSchema = z.object({
  needId: IdSchema,

  product: ProductSnapshotSchema,

  focusAttributeIds: z.array(IdSchema).max(32),
  reviewExperience: ProductReviewExperienceSchema.nullable().optional(),
  reviewAnswer: ProductReviewAnswerSchema.nullable().optional(),
});

export type ProductPresentationAttribute = z.infer<
  typeof ProductPresentationAttributeSchema
>;

export type ProductSnapshot = z.infer<typeof ProductSnapshotSchema>;

export type ProductDetailsPresentation = z.infer<
  typeof ProductDetailsPresentationSchema
>;
