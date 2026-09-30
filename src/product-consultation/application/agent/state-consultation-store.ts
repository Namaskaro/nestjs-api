import {
  ConsultationApplicationRecordSchema,
  type ConsultationApplicationRecord,
} from '@/src/product-consultation/application/runtime/consultation-application-record';

import {
  ConsultationWriteConflictError,
  type ConsultationApplicationStore,
} from '@/src/product-consultation/application/runtime/consultation-application-store.port';

export class StateConsultationStore implements ConsultationApplicationStore {
  private record: ConsultationApplicationRecord;

  constructor(record: ConsultationApplicationRecord) {
    this.record = ConsultationApplicationRecordSchema.parse(
      structuredClone(record),
    );
  }

  async load(_conversationId: string): Promise<ConsultationApplicationRecord> {
    return ConsultationApplicationRecordSchema.parse(
      structuredClone(this.record),
    );
  }

  async saveIfRevision(input: {
    conversationId: string;
    expectedRevision: number;
    record: ConsultationApplicationRecord;
  }): Promise<void> {
    if (this.record.revision !== input.expectedRevision) {
      throw new ConsultationWriteConflictError(
        input.conversationId,
        input.expectedRevision,
        this.record.revision,
      );
    }

    this.record = ConsultationApplicationRecordSchema.parse(
      structuredClone(input.record),
    );
  }
}
