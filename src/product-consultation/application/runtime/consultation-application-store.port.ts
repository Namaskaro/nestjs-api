import type { ConsultationApplicationRecord } from './consultation-application-record';

/**
 * Optimistic concurrency conflict.
 *
 * Store adapter обязан бросать эту ошибку,
 * если persisted revision уже отличается
 * от expectedRevision.
 */
export class ConsultationWriteConflictError extends Error {
  constructor(
    public readonly conversationId: string,

    public readonly expectedRevision: number,

    public readonly actualRevision: number | null,
  ) {
    super(
      `Consultation write conflict for ${conversationId}: ` +
        `expected revision ${expectedRevision}, ` +
        `actual ${String(actualRevision)}.`,
    );

    this.name = 'ConsultationWriteConflictError';
  }
}

/**
 * Persistence boundary нового
 * Product Consultation runtime.
 *
 * Одна запись содержит одновременно:
 *
 * - consultation state;
 * - results lifecycle;
 * - task generation;
 * - idempotency state;
 * - optimistic revision.
 *
 * Core о persistence ничего не знает.
 */
export interface ConsultationApplicationStore {
  load(conversationId: string): Promise<ConsultationApplicationRecord | null>;

  /**
   * Atomic compare-and-set.
   *
   * Если persisted revision уже
   * не равен expectedRevision,
   * запись запрещена.
   *
   * Для ещё отсутствующей записи
   * logical revision считается 0.
   */
  saveIfRevision(input: {
    conversationId: string;

    expectedRevision: number;

    record: ConsultationApplicationRecord;
  }): Promise<void>;
}
