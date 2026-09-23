import { z } from 'zod';

const ProductIdSchema = z.string().trim().min(1).max(160);

export const ConsultationResultProductSchema = z.object({
  productId: ProductIdSchema,

  title: z.string().trim().min(1),

  price: z.string().trim().min(1),

  image: z.string().trim().min(1).nullable(),
});

export const ConsultationResultsStateSchema = z
  .object({
    version: z.literal(1),

    /**
     * Меняется каждый раз,
     * когда новый search заменяет active results.
     */
    revision: z.number().int().nonnegative(),

    /**
     * Единственный authoritative result set
     * текущей консультации.
     *
     * Никаких displayOrder /
     * comparison / referenceOrder.
     */
    active: z.array(ConsultationResultProductSchema).max(25),
  })
  .superRefine((state, context) => {
    const productIds = state.active.map((product) => product.productId);

    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: 'custom',

        path: ['active'],

        message: 'ConsultationResultsState contains duplicate productId.',
      });
    }
  });

export type ConsultationResultProduct = z.infer<
  typeof ConsultationResultProductSchema
>;

export type ConsultationResultsState = z.infer<
  typeof ConsultationResultsStateSchema
>;
