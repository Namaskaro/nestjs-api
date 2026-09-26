import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { ConsultationResultsStateSchema } from '../../core/results/consultation-results.schema';

import { createConsultationResultsState } from '../../core/results/consultation-results';

import { ProductConsultationStateSchema } from '../../core/state/consultation-state.schema';

const MAX_PROCESSED_REQUEST_IDS = 128;

export const ConsultationRequestIdSchema = z.string().trim().min(1).max(200);

export const ConsultationApplicationRecordSchema = z
  .object({
    version: z.literal(1),

    /**
     * Optimistic concurrency revision
     * всей aggregate-записи.
     *
     * State + Results меняются
     * только через этот revision.
     */
    revision: z.number().int().nonnegative(),

    /**
     * Поколение текущей task.
     *
     * start_new:
     *
     * generation N
     *       ↓
     * generation N + 1
     *
     * Late async result старого поколения
     * не имеет права менять новую task.
     */
    generation: z.number().int().nonnegative(),

    /**
     * Новый deterministic consultation state.
     *
     * До первого turn может отсутствовать.
     */
    state: ProductConsultationStateSchema.nullable(),

    /**
     * Search lifecycle принадлежит
     * той же aggregate-записи.
     */
    results: ConsultationResultsStateSchema,

    /**
     * Server-owned idempotency keys.
     *
     * Это request/message IDs приложения,
     * а НЕ значения, придуманные LLM.
     */
    processedRequestIds: z
      .array(ConsultationRequestIdSchema)
      .max(MAX_PROCESSED_REQUEST_IDS),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      new Set(record.processedRequestIds).size !==
      record.processedRequestIds.length
    ) {
      context.addIssue({
        code: 'custom',

        path: ['processedRequestIds'],

        message:
          'ConsultationApplicationRecord contains duplicate request IDs.',
      });
    }

    /**
     * State.search является authoritative
     * описанием текущего поиска.
     *
     * pendingSearch обязан относиться
     * именно к этому SearchSpec.
     *
     * Иначе возможна ситуация:
     *
     * State:
     *   Adidas
     *
     * pending:
     *   Nike
     *
     * Такой aggregate нельзя считать
     * согласованным.
     */
    if (record.results.pendingSearch !== null) {
      if (
        record.state?.search === null ||
        record.state?.search === undefined ||
        !isDeepStrictEqual(
          record.state.search,

          record.results.pendingSearch.search,
        )
      ) {
        context.addIssue({
          code: 'custom',

          path: ['results', 'pendingSearch'],

          message:
            'pending SearchSpec does not match authoritative state SearchSpec.',
        });
      }
    }

    /**
     * То же правило для active result.
     *
     * Если текущий State уже относится
     * к другой задаче/SearchSpec,
     * старый active snapshot нельзя
     * выдавать за текущую выдачу.
     */
    if (record.results.active !== null) {
      if (
        record.state?.search === null ||
        record.state?.search === undefined ||
        !isDeepStrictEqual(
          record.state.search,

          record.results.active.search,
        )
      ) {
        context.addIssue({
          code: 'custom',

          path: ['results', 'active'],

          message:
            'active SearchSpec does not match authoritative state SearchSpec.',
        });
      }
    }

    /**
     * lastConfirmed специально НЕ обязан
     * совпадать с текущим State.search.
     *
     * Пример:
     *
     * Nike был успешно найден.
     * Затем запустили Adidas.
     * Adidas search технически упал.
     *
     * State.search = Adidas
     * active = null
     * lastConfirmed = Nike
     *
     * Это корректный lifecycle.
     */
  });

export type ConsultationApplicationRecord = z.infer<
  typeof ConsultationApplicationRecordSchema
>;

export function createConsultationApplicationRecord(): ConsultationApplicationRecord {
  return ConsultationApplicationRecordSchema.parse({
    version: 1,

    revision: 0,

    generation: 0,

    state: null,

    results: createConsultationResultsState(),

    processedRequestIds: [],
  });
}

export function appendProcessedRequestId(
  current: readonly string[],

  requestIdRaw: string,
): string[] {
  const requestId = ConsultationRequestIdSchema.parse(requestIdRaw);

  if (current.includes(requestId)) {
    return [...current];
  }

  return [...current, requestId].slice(-MAX_PROCESSED_REQUEST_IDS);
}
