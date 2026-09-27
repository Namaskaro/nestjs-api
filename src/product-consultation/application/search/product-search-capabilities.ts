import { z } from 'zod';

import { SearchConstraintOperatorSchema } from '../../core/search/search-spec.schema';

const CapabilityIdSchema = z.string().trim().min(1).max(160);

export const ProductSearchConstraintCapabilitySchema = z
  .object({
    attributeId: CapabilityIdSchema,

    operators: z.array(SearchConstraintOperatorSchema).min(1).max(4),

    /**
     * false означает:
     *
     * adapter всё ещё умеет
     * deterministic исполнять этот
     * constraint, например для legacy /
     * backward compatibility,
     *
     * но новый Product Consultant
     * не должен получать его как
     * рекомендуемый model-facing search input.
     *
     * Пример current store:
     *
     * type:eq поддерживается,
     * но после B3 profile/category
     * уже сам задаёт store type scope.
     */
    modelVisible: z.boolean(),
  })
  .strict()
  .superRefine((capability, context) => {
    if (new Set(capability.operators).size !== capability.operators.length) {
      context.addIssue({
        code: 'custom',

        path: ['operators'],

        message:
          `Search capability ${capability.attributeId} ` +
          'contains duplicate operators.',
      });
    }
  });

export const ProductSearchCapabilitiesSchema = z
  .object({
    /**
     * Consultation profiles/categories,
     * которые этот store adapter
     * умеет исполнять.
     */
    profileIds: z.array(CapabilityIdSchema).min(1).max(32),

    /**
     * Store-side executable hard constraints.
     *
     * CategoryProfile определяет
     * semantic attribute contract.
     *
     * Этот descriptor определяет:
     *
     * "что конкретный store adapter
     * реально умеет выполнить".
     */
    constraints: z.array(ProductSearchConstraintCapabilitySchema).max(64),

    /**
     * Adapter-specific upper bound.
     *
     * null:
     * дополнительного ограничения
     * поверх SearchSpec contract нет.
     */
    maxConstraints: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((capabilities, context) => {
    if (
      new Set(capabilities.profileIds).size !== capabilities.profileIds.length
    ) {
      context.addIssue({
        code: 'custom',

        path: ['profileIds'],

        message: 'Search capabilities contain duplicate profile IDs.',
      });
    }

    const attributeIds = capabilities.constraints.map(
      (capability) => capability.attributeId,
    );

    if (new Set(attributeIds).size !== attributeIds.length) {
      context.addIssue({
        code: 'custom',

        path: ['constraints'],

        message:
          'Search capabilities contain duplicate constraint attribute IDs.',
      });
    }
  });

export type ProductSearchConstraintCapability = z.infer<
  typeof ProductSearchConstraintCapabilitySchema
>;

export type ProductSearchCapabilities = z.infer<
  typeof ProductSearchCapabilitiesSchema
>;
