import { z } from 'zod';

import { ProductItemSchema } from '../agents/product-agent/schemas/product-agent-result.schema';
import {
  ConsultationMemorySchema,
  emptyConsultationMemory,
} from '../agents/product-agent/consultation-core/consultation-core.schema';
import {
  ProductNeedSchema,
  ProductSearchFiltersSchema,
} from '../agents/product-agent/schemas/product-need.schema';

export const ProductReferenceSchema = z.object({
  needId: z.string().min(1),

  productId: z.string().min(1),
});

export const ProductClarificationFieldSchema = z.enum([
  'gender',
  'size',
  'color',
  'brand',
  'price',
  'style',
  'occasion',
  'material',
  'other',
]);

export const PendingProductClarificationSchema = z.object({
  needId: z.string().min(1).nullable(),

  kind: z.enum(['clarification', 'refine', 'alternatives']),

  question: z.string().trim().min(1),

  fields: z.array(ProductClarificationFieldSchema).max(3),

  proposal: z.string().trim().min(1).nullable(),
});

export const ProductNeedMemorySchema = z.object({
  needId: z.string().min(1),

  semanticQuery: z.string().trim().min(1),

  filters: ProductSearchFiltersSchema,

  preferences: z.array(z.string().trim().min(1)).max(10),

  shownProducts: z.array(ProductItemSchema).max(5),

  consultation: ConsultationMemorySchema.default(() =>
    emptyConsultationMemory(),
  ),
});

const ProductContextV2Schema = z.object({
  version: z.literal(2),

  needs: z.array(ProductNeedMemorySchema).max(5),

  displayOrder: z.array(ProductReferenceSchema).max(25),

  comparison: z.array(ProductReferenceSchema).max(4),

  pendingClarification: PendingProductClarificationSchema.nullable(),
});

const LegacyProductContextSchema = z.object({
  needs: z.array(ProductNeedSchema).min(1).max(5),
});

export type ProductContext = z.infer<typeof ProductContextV2Schema>;

export type ProductNeedMemory = z.infer<typeof ProductNeedMemorySchema>;

export type ProductReference = z.infer<typeof ProductReferenceSchema>;

export function emptyProductContext(): ProductContext {
  return {
    version: 2,

    needs: [],

    displayOrder: [],

    comparison: [],

    pendingClarification: null,
  };
}

export const ProductContextSchema = z.preprocess((value) => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 2
  ) {
    return value;
  }

  const legacy = LegacyProductContextSchema.safeParse(value);

  if (!legacy.success) {
    return value;
  }

  return {
    ...emptyProductContext(),

    needs: legacy.data.needs.map((need, index) => ({
      needId: `legacy-${index + 1}`,

      semanticQuery: need.semanticQuery,

      filters: need.filters,

      preferences: [],

      shownProducts: [],

      consultation: emptyConsultationMemory(),
    })),
  };
}, ProductContextV2Schema);

export function readProductContext(value: unknown): ProductContext {
  return value == null
    ? emptyProductContext()
    : ProductContextSchema.parse(value);
}
