import { z } from 'zod';

import { SearchSpecSchema } from '../search/search-spec.schema';

const IdSchema = z.string().trim().min(1).max(160);

export const ConsultationResultProductSchema = z
  .object({
    productId: IdSchema,

    title: z.string().trim().min(1),

    price: z.string().trim().min(1),

    image: z.string().trim().min(1).nullable(),
  })
  .strict();

export const SearchExecutionSchema = z
  .object({
    executionId: IdSchema,

    search: SearchSpecSchema,
  })
  .strict();

/**
 * Immutable snapshot готовой выдачи.
 *
 * Содержит:
 *
 * - server-owned resultId;
 * - execution, который её создал;
 * - фактически выполненный SearchSpec;
 * - порядок показанных товаров.
 */
export const SearchResultSnapshotSchema = z
  .object({
    resultId: IdSchema,

    executionId: IdSchema,

    search: SearchSpecSchema,

    products: z.array(ConsultationResultProductSchema).max(25),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const productIds = snapshot.products.map((product) => product.productId);

    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: 'custom',

        path: ['products'],

        message: 'SearchResultSnapshot contains duplicate productId.',
      });
    }
  });

export const ConsultationResultsStateSchema = z
  .object({
    version: z.literal(1),

    revision: z.number().int().nonnegative(),

    /**
     * Search, результат которого система
     * сейчас имеет право принять.
     */
    pendingSearch: SearchExecutionSchema.nullable(),

    /**
     * Последняя подтверждённая активная выдача.
     *
     * При запуске нового search она очищается,
     * чтобы ordinal references не указывали
     * на товары предыдущего запроса.
     */
    active: SearchResultSnapshotSchema.nullable(),
  })
  .strict();

export type ConsultationResultProduct = z.infer<
  typeof ConsultationResultProductSchema
>;

export type SearchExecution = z.infer<typeof SearchExecutionSchema>;

export type SearchResultSnapshot = z.infer<typeof SearchResultSnapshotSchema>;

export type ConsultationResultsState = z.infer<
  typeof ConsultationResultsStateSchema
>;
