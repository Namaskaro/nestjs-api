import { z } from 'zod';

import { SearchConstraintOperatorSchema } from '../../core/search/search-spec.schema';

const CapabilityIdSchema = z.string().trim().min(1).max(160);

export const ProductSearchConstraintCapabilitySchema = z
  .object({
    attributeId: CapabilityIdSchema,
    operators: z.array(SearchConstraintOperatorSchema).min(1).max(4),
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
    profileIds: z.array(CapabilityIdSchema).min(1).max(32),
    constraints: z.array(ProductSearchConstraintCapabilitySchema).max(64),
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
