import { z } from 'zod';

const SearchIdSchema = z.string().trim().min(1).max(160);

export const SearchConstraintOperatorSchema = z.enum([
  'eq',
  'contains',
  'lte',
  'gte',
]);

export const SearchConstraintValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const SearchConstraintSchema = z
  .object({
    attributeId: SearchIdSchema,

    operator: SearchConstraintOperatorSchema,

    value: SearchConstraintValueSchema,

    unit: z.string().trim().min(1).nullable().default(null),
  })
  .strict();

export const SearchConstraintSelectorSchema = z
  .object({
    attributeId: SearchIdSchema,

    operator: SearchConstraintOperatorSchema,
  })
  .strict();

const SearchSpecFieldsSchema = z
  .object({
    semanticIntent: z.string().trim().min(1).max(1000),

    category: SearchIdSchema.nullable(),

    constraints: z.array(SearchConstraintSchema),
  })
  .strict();

function validateUniqueConstraints(
  constraints: readonly z.infer<typeof SearchConstraintSchema>[],
): string | null {
  const seen = new Set<string>();

  for (const constraint of constraints) {
    const key = `${constraint.attributeId}:${constraint.operator}`;

    if (seen.has(key)) {
      return key;
    }

    seen.add(key);
  }

  return null;
}

export const SearchSpecDraftSchema = SearchSpecFieldsSchema.superRefine(
  (spec, context) => {
    const duplicate = validateUniqueConstraints(spec.constraints);

    if (duplicate) {
      context.addIssue({
        code: 'custom',

        path: ['constraints'],

        message: `Duplicate SearchSpec constraint: ${duplicate}`,
      });
    }
  },
);

export const SearchSpecSchema = z
  .object({
    version: z.literal(1),

    ...SearchSpecFieldsSchema.shape,
  })
  .strict()
  .superRefine((spec, context) => {
    const duplicate = validateUniqueConstraints(spec.constraints);

    if (duplicate) {
      context.addIssue({
        code: 'custom',

        path: ['constraints'],

        message: `Duplicate SearchSpec constraint: ${duplicate}`,
      });
    }
  });

export const SearchSpecPatchSchema = z
  .object({
    semanticIntent: z.string().trim().min(1).max(1000).optional(),

    category: SearchIdSchema.nullable().optional(),

    set: z.array(SearchConstraintSchema).default(() => []),

    clear: z.array(SearchConstraintSelectorSchema).default(() => []),
  })
  .strict();

export type SearchConstraint = z.infer<typeof SearchConstraintSchema>;

export type SearchConstraintSelector = z.infer<
  typeof SearchConstraintSelectorSchema
>;

export type SearchSpecDraft = z.infer<typeof SearchSpecDraftSchema>;

export type SearchSpec = z.infer<typeof SearchSpecSchema>;

export type SearchSpecPatch = z.infer<typeof SearchSpecPatchSchema>;
