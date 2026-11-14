
export type PreferenceValue = string | number | boolean;

export interface PreferenceCriterionKey {
  attributeId: string;
  operator: 'eq' | 'contains' | 'lte' | 'gte';
}

export interface UserContextKey {
  storeKey: string;
  subjectKey: string;
}

export interface PreferenceKey {
  domainKey: string;
  preferenceKey: string;
}

export interface PreferenceEvidenceRef {
  sourceKind: string;
  sourceKey: string;
  episodeId: string;
  episodeRevision: number;
  criterion: PreferenceCriterionKey;
}

export interface ConfirmPreference extends PreferenceKey {
  commandId: string;
  expectedRevision: number;
  evidence: PreferenceEvidenceRef;
}

export type PreferenceObservation =
  | { state: 'candidate'; value: PreferenceValue }
  | { state: 'confirmed'; value: PreferenceValue; evidence: PreferenceEvidenceRef };

export interface PreferenceFact extends PreferenceKey {
  value: PreferenceValue;
  confirmation: 'CONFIRMED';
  source: PreferenceEvidenceRef;
  commandId: string;
  observedAt: Date;
  confirmedAt: Date;
  updatedAt: Date;
}

export interface PreferenceEvidence {
  revision: number;
  profileId: string | null;
  criteria: Array<PreferenceCriterionKey & { value: PreferenceValue }>;
  observedAt: Date;
}

export interface StoreEventV1 {
  id: string;
  type: 'consultation.preference_confirmed';
  storeKey: string;
  subjectKey: string;
  occurredAt: string;
  schemaVersion: 1;
  source: { system: string; externalId: string };
  payload: { preference: PreferenceKey; evidence: PreferenceEvidenceRef };
}
