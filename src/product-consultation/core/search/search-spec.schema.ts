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

type ConstraintIdentity = {
  attributeId: string;

  operator: z.infer<typeof SearchConstraintOperatorSchema>;
};

function constraintKey(constraint: ConstraintIdentity): string {
  return `${constraint.attributeId}:${constraint.operator}`;
}

function validateUniqueConstraints(
  constraints: readonly ConstraintIdentity[],
): string | null {
  const seen = new Set<string>();

  for (const constraint of constraints) {
    const key = constraintKey(constraint);

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
  .strict()
  .superRefine((patch, context) => {
    /**
     * Один semantic constraint slot
     * может изменяться в одном patch
     * максимум один раз.
     *
     * Identity:
     *
     * attributeId + operator
     *
     * Поэтому:
     *
     * price:gte + price:lte
     *
     * валидны как два разных slot.
     *
     * Но:
     *
     * brand:eq + brand:eq
     *
     * или:
     *
     * set brand:eq + clear brand:eq
     *
     * неоднозначны и запрещены.
     */
    const seen = new Map<
      string,
      {
        operation: 'set' | 'clear';

        index: number;
      }
    >();

    patch.set.forEach((constraint, index) => {
      const key = constraintKey(constraint);

      const previous = seen.get(key);

      if (previous) {
        context.addIssue({
          code: 'custom',

          path: ['set', index],

          message: `Duplicate SearchSpecPatch target: ${key}`,
        });

        return;
      }

      seen.set(key, {
        operation: 'set',

        index,
      });
    });

    patch.clear.forEach((selector, index) => {
      const key = constraintKey(selector);

      const previous = seen.get(key);

      if (previous) {
        context.addIssue({
          code: 'custom',

          path: ['clear', index],

          message:
            previous.operation === 'set'
              ? `SearchSpecPatch cannot set and clear the same target: ${key}`
              : `Duplicate SearchSpecPatch target: ${key}`,
        });

        return;
      }

      seen.set(key, {
        operation: 'clear',

        index,
      });
    });
  });

export type SearchConstraint = z.infer<typeof SearchConstraintSchema>;

export type SearchConstraintSelector = z.infer<
  typeof SearchConstraintSelectorSchema
>;

export type SearchSpecDraft = z.infer<typeof SearchSpecDraftSchema>;

export type SearchSpec = z.infer<typeof SearchSpecSchema>;

export type SearchSpecPatch = z.infer<typeof SearchSpecPatchSchema>;
