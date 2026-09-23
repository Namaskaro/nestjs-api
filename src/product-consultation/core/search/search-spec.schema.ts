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

export const SearchConstraintSchema = z.object({
  attributeId: SearchIdSchema,

  operator: SearchConstraintOperatorSchema,

  value: SearchConstraintValueSchema,

  unit: z.string().trim().min(1).nullable().default(null),
});

export const SearchConstraintSelectorSchema = z.object({
  attributeId: SearchIdSchema,

  operator: SearchConstraintOperatorSchema,
});

/**
 * Общая shape для:
 *
 * - initial SearchSpec;
 * - persistent SearchSpec.
 *
 * Нам нужна отдельная base schema,
 * потому что Zod v4 запрещает .omit()
 * на schema с refinements.
 */
const SearchSpecFieldsSchema = z.object({
  semanticIntent: z.string().trim().min(1).max(1000),

  category: SearchIdSchema.nullable(),

  constraints: z.array(SearchConstraintSchema),
});

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

/**
 * SearchSpec до того, как Core добавил
 * server-owned version.
 */
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

export const SearchSpecPatchSchema = z.object({
  /**
   * undefined = оставить как есть.
   */
  semanticIntent: z.string().trim().min(1).max(1000).optional(),

  /**
   * undefined = оставить;
   * null = очистить category.
   */
  category: SearchIdSchema.nullable().optional(),

  /**
   * Добавляет constraint либо заменяет
   * constraint с тем же attributeId + operator.
   */
  set: z.array(SearchConstraintSchema).default(() => []),

  /**
   * Удаляет только явно указанные constraints.
   */
  clear: z.array(SearchConstraintSelectorSchema).default(() => []),
});

export type SearchConstraint = z.infer<typeof SearchConstraintSchema>;

export type SearchConstraintSelector = z.infer<
  typeof SearchConstraintSelectorSchema
>;

export type SearchSpecDraft = z.infer<typeof SearchSpecDraftSchema>;

export type SearchSpec = z.infer<typeof SearchSpecSchema>;

export type SearchSpecPatch = z.infer<typeof SearchSpecPatchSchema>;
