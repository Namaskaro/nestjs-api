import { z } from 'zod';

export const ProductAttributeIdSchema = z.string().trim().min(1).max(160);

export const ProductAttributeKindSchema = z.enum([
  'text',
  'number',
  'boolean',
  'set',
]);

export const ProductAttributeStatusSchema = z.enum([
  'known',
  'unknown',
  'not_applicable',
  'conflicting',
]);

export const ProductAttributeScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const ProductAttributeValueSchema = z.union([
  ProductAttributeScalarSchema,

  z.array(z.string()),

  z.null(),
]);

export const ProductAttributeDefinitionSchema = z
  .object({
    id: ProductAttributeIdSchema,

    label: z.string().trim().min(1),

    kind: ProductAttributeKindSchema,

    /**
     * Canonical unit.
     *
     * Например:
     * kg
     * mm
     * L
     * hp
     * GB
     *
     * null — если единица измерения не нужна.
     */
    unit: z.string().trim().min(1).nullable(),
  })
  .superRefine((attribute, ctx) => {
    if (attribute.kind !== 'number' && attribute.unit !== null) {
      ctx.addIssue({
        code: 'custom',

        message: `Unit допустим только для number attribute: ${attribute.id}.`,
      });
    }
  });

export const ProductSourceSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),

  recordId: z.string().trim().min(1).max(160),

  observedAt: z.string().datetime(),

  updatedAt: z.string().datetime().nullable(),
});

export const ProductAttributeProvenanceSchema = ProductSourceSchema.extend({
  paths: z.array(z.string().min(1)).min(1),

  transformation: z.string().min(1).nullable(),
});

export const ProductAttributeSchema = z
  .object({
    attributeId: ProductAttributeIdSchema,

    kind: ProductAttributeKindSchema,

    unit: z.string().trim().min(1).nullable(),

    status: ProductAttributeStatusSchema,

    value: ProductAttributeValueSchema,

    /**
     * Человекочитаемое значение.
     *
     * Например:
     *
     * value = 340
     * unit = "hp"
     * displayValue = "340 л.с."
     */
    displayValue: z.string().nullable(),

    provenance: z.array(ProductAttributeProvenanceSchema),
  })
  .superRefine((attribute, ctx) => {
    if (attribute.status !== 'known') {
      if (attribute.value !== null) {
        ctx.addIssue({
          code: 'custom',

          message:
            `ProductAttribute ${attribute.attributeId}: ` +
            'status != known требует value=null.',
        });
      }

      return;
    }

    const validValue =
      (attribute.kind === 'text' && typeof attribute.value === 'string') ||
      (attribute.kind === 'number' && typeof attribute.value === 'number') ||
      (attribute.kind === 'boolean' && typeof attribute.value === 'boolean') ||
      (attribute.kind === 'set' && Array.isArray(attribute.value));

    if (!validValue) {
      ctx.addIssue({
        code: 'custom',

        message:
          `ProductAttribute ${attribute.attributeId} ` +
          'содержит value неверного типа.',
      });
    }

    if (attribute.provenance.length === 0) {
      ctx.addIssue({
        code: 'custom',

        message:
          `Known ProductAttribute ${attribute.attributeId} ` +
          'должен иметь provenance.',
      });
    }
  });

export type ProductAttributeKind = z.infer<typeof ProductAttributeKindSchema>;

export type ProductAttributeDefinition = z.infer<
  typeof ProductAttributeDefinitionSchema
>;

export type ProductSource = z.infer<typeof ProductSourceSchema>;

export type ProductAttributeProvenance = z.infer<
  typeof ProductAttributeProvenanceSchema
>;

export type ProductAttribute = z.infer<typeof ProductAttributeSchema>;

export type ProductAttributeValue = z.infer<typeof ProductAttributeValueSchema>;
