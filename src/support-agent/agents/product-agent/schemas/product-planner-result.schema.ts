import { z } from 'zod';

import { ProductClarificationFieldSchema } from '../../../schemas/product-context.schema';

const NeedIndexSchema = z.number().int().min(1).max(5);

export const ProductActionSchema = z.enum([
  'SEARCH',
  'SHOW',
  'COMPARE',
  'DETAILS',
  'FEEDBACK',
  'CONSULT',
  'CLARIFY',
]);

// ===== START CHANGE: FILTER PATCH =====

export const ProductFilterPatchSchema = z.object({
  gender: z.enum(['MAN', 'WOMAN', 'UNISEX']).nullable().optional(),

  type: z.enum(['SHOES', 'CLOTHES', 'ACCESSORIES']).nullable().optional(),

  category: z.string().trim().min(1).max(200).nullable().optional(),

  subcategory: z.string().trim().min(1).max(200).nullable().optional(),

  color: z.string().trim().min(1).max(100).nullable().optional(),

  size: z
    .union([z.string().trim().min(1).max(50), z.number().finite(), z.null()])
    .optional(),

  minPrice: z
    .union([
      z.number().finite().nonnegative(),
      z.string().trim().min(1).max(50),
      z.null(),
    ])
    .optional(),

  maxPrice: z
    .union([
      z.number().finite().nonnegative(),
      z.string().trim().min(1).max(50),
      z.null(),
    ])
    .optional(),
});

export type ProductFilterPatch = z.infer<typeof ProductFilterPatchSchema>;

// ===== END CHANGE: FILTER PATCH =====

export const ProductNeedPatchSchema = z.object({
  needIndex: NeedIndexSchema.nullable(),

  semanticQuery: z.string().trim().min(1).max(1000).nullable(),

  // ===== START CHANGE: FILTER CHANGES -> FILTER PATCH =====

  filterPatch: ProductFilterPatchSchema,

  // ===== END CHANGE: FILTER CHANGES -> FILTER PATCH =====

  brandMode: z.enum(['keep', 'candidate', 'required', 'preferred', 'clear']),

  brandValue: z.string().trim().min(1).max(100).nullable(),

  brandSource: z.string().trim().min(1).max(500).nullable(),

  addPreferences: z.array(z.string().trim().min(1).max(500)).max(10),

  removePreferences: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const ProductPlannerResultSchema = z.object({
  action: ProductActionSchema,

  updates: z.array(ProductNeedPatchSchema).max(5),

  removeNeedIndexes: z.array(NeedIndexSchema).max(5),

  reuseNeedIndexes: z.array(NeedIndexSchema).max(5),

  referenceSource: z.enum(['display', 'comparison']),

  positions: z.array(z.number().int().min(1).max(25)).max(4),

  attributeIds: z.array(z.string().trim().min(1)).max(8),

  reaction: z.enum(['like', 'dislike', 'mixed']).nullable(),

  question: z.string().trim().min(1).max(500).nullable(),

  clarificationNeedIndex: NeedIndexSchema.nullable(),

  clarificationFields: z.array(ProductClarificationFieldSchema).max(3),
});

export type ProductNeedPatch = z.infer<typeof ProductNeedPatchSchema>;

export type ProductPlannerResult = z.infer<typeof ProductPlannerResultSchema>;
