export type MemoryOperator = 'eq' | 'contains' | 'lte' | 'gte';

export interface MemoryConstraintKey {
  attributeId: string;
  operator: MemoryOperator;
}

export interface MemoryConstraint extends MemoryConstraintKey {
  value: string | number | boolean;
  unit: string | null;
}

export interface MemoryCriteriaPatch {
  profileId?: string | null;
  goalKey?: string | null;
  set?: MemoryConstraint[];
  clear?: MemoryConstraintKey[];
}

export type MemoryOutcome =
  | 'PRODUCT_SELECTED'
  | 'NO_MATCH'
  | 'USER_CANCELLED'
  | 'FINISHED_UNSPECIFIED';

export interface ConsultationEpisodeChange {
  taskKey: string;
  kind: 'start' | 'update';
  previousSourceMessageId?: string;
  criteria?: MemoryCriteriaPatch;
  considered?: string[];
  compared?: string[];
  recommended?: string[];
  outcome?: MemoryOutcome;
}

export interface ConsultationMemoryCandidate {
  sourceMessageId: string;
  changes: ConsultationEpisodeChange[];
}

export interface ConsultationMemoryWitness {
  revision: number;
  sourceMessageId: string | null;
}
