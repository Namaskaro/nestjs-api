
import type { MemorySnapshot } from './consultation-memory.core';
import type { ConsultationMemoryWitness, MemoryConstraintKey, MemoryOutcome } from './memory.contract';

export interface MemoryScopeKey {
  storeKey: string;
  subjectKey: string;
  sourceKind: string;
  sourceKey: string;
}

export interface MemorySourceState {
  subjectKey: string;
  authorizedCustomer: boolean;
  assistantAvailable: boolean;
  nextIntent?: 'start_new';
  inputSeq: number;
  handoffVersion: number;
  attemptId: string | null;
  sourceMessageId: string | null;
}

export interface MemoryAdmission {
  key: MemoryScopeKey;
  sourceMessageId: string;
  inputSeq: number;
  attemptId: string;
  handoffVersion: number;
}

export interface MemoryContinuation {
  episodeId: string;
  taskKey: string;
  revision: number;
  snapshot: Pick<MemorySnapshot, 'profileId' | 'goalKey' | 'constraints' | 'lastSourceMessageId'>;
}

export interface MemoryBasis extends MemoryAdmission {
  memoryEpoch: number;
  revisions: Record<string, number>;
  witnesses: Record<string, ConsultationMemoryWitness>;
  continuation?: MemoryContinuation;
}

export interface MemoryScope extends MemoryScopeKey {
  id: string;
  memoryEpoch: number;
  purgedThroughSeq: number;
  offerSuppressedUntil: Date | null;
}

export interface EpisodeData {
  snapshot: MemorySnapshot;
  schemaVersion: 1 | 2;
  status: 'OPEN' | 'CLOSED';
  outcome: MemoryOutcome | null;
  closedAt: Date | null;
  lastMeaningfulAt: Date;
  expiresAt: Date;
}

export interface MemoryEpisode extends Omit<EpisodeData, 'snapshot' | 'schemaVersion'> {
  id: string;
  scopeId: string;
  taskKey: string;
  type: string;
  revision: number;
  contentRevision: number;
  schemaVersion: number;
  snapshot: unknown;
}

export type ResumeDecision = 'continue' | 'later' | 'start_new';

export interface OfferData {
  scopeId: string;
  episodeId: string;
  episodeRevision: number;
  contentRevision: number;
  memoryEpoch: number;
  inputSeq: number;
  handoffVersion: number;
  expiresAt: Date;
}

export interface MemoryOffer extends OfferData {
  id: string;
  decision: ResumeDecision | null;
  consumedAt: Date | null;
  scope: MemoryScope;
  episode: MemoryEpisode;
}

export interface MemoryReceipt {
  sourceMessageId: string;
  assistantMessageId: string;
  inputSeq: number;
  payloadHash: string;
  appliedRevisions: Record<string, number>;
  expiresAt: Date;
}

export interface MemoryEpisodeSelection {
  ids?: string[];
  tasks?: string[];
  open?: boolean;
  liveAt?: Date;
  inactiveSince?: Date;
  limit?: number;
}

export interface MemoryUnit {
  sourceState(key: MemoryScopeKey, lock: boolean): Promise<MemorySourceState | null>;
  sourceInput(admission: MemoryAdmission): Promise<{ offerId?: string; action?: 'resume_unchanged' | 'start_new' } | null>;
  hasReply(key: MemoryScopeKey, inputId: string, replyId?: string): Promise<boolean>;
  markStartNew(key: MemoryScopeKey, source: MemorySourceState): Promise<void>;
  getScope(key: MemoryScopeKey): Promise<MemoryScope | null>;
  addScope(key: MemoryScopeKey): Promise<MemoryScope>;
  updateScope(id: string, change: Partial<Pick<MemoryScope, 'memoryEpoch' | 'purgedThroughSeq' | 'offerSuppressedUntil'>>): Promise<void>;
  episodes(scopeId: string, selection: MemoryEpisodeSelection): Promise<MemoryEpisode[]>;
  writeEpisode(scopeId: string, taskKey: string, previous: MemoryEpisode | null, data: EpisodeData, contentChanged: boolean): Promise<MemoryEpisode>;
  revokeEpisodePreferences?(key: MemoryScopeKey, episodeId: string, changed?: MemoryConstraintKey[]): Promise<void>;
  removeEpisode(scopeId: string, episodeId: string, expiredAt?: Date): Promise<boolean>;
  getOffer(id: string): Promise<MemoryOffer | null>;
  episodeOffer(episodeId: string, contentRevision: number): Promise<MemoryOffer | null>;
  addOffer(offer: OfferData): Promise<MemoryOffer>;
  updateOffer(id: string, change: { decision?: ResumeDecision; decidedAt?: Date; consumedAt?: Date }): Promise<void>;
  receipt(scopeId: string, inputId: string): Promise<Pick<MemoryReceipt, 'payloadHash' | 'assistantMessageId'> | null>;
  addReceipt(scopeId: string, receipt: MemoryReceipt): Promise<void>;
}

export interface MemoryRepository {
  read: MemoryUnit;
  transaction<T>(operation: (unit: MemoryUnit) => Promise<T>): Promise<T>;
  expiredEpisodes(storeKey: string, now: Date): Promise<Array<{ id: string; scope: MemoryScope }>>;
  purgeReceipts(storeKey: string, now: Date): Promise<void>;
}
