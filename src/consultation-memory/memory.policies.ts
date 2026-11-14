
import type { MemoryAdmission, MemoryBasis, MemoryEpisode, MemoryOffer, MemoryScope, MemoryScopeKey, MemorySourceState } from './memory.port';
import { MEMORY_PAUSE_AFTER_MS, memorySnapshotSchema, type MemorySnapshot } from './consultation-memory.core';

export function ownsScope(scope: MemoryScopeKey, key: MemoryScopeKey): boolean {
  return scope.storeKey === key.storeKey && scope.subjectKey === key.subjectKey &&
    scope.sourceKind === key.sourceKind && scope.sourceKey === key.sourceKey;
}

export function ownsSource(source: MemorySourceState | null, key: MemoryScopeKey): source is MemorySourceState {
  return Boolean(source?.authorizedCustomer && source.subjectKey === key.subjectKey);
}

export function currentAdmission(source: MemorySourceState | null, admission: MemoryAdmission): source is MemorySourceState {
  return ownsSource(source, admission.key) && source.assistantAvailable &&
    source.handoffVersion === admission.handoffVersion && source.inputSeq === admission.inputSeq &&
    source.attemptId === admission.attemptId && source.sourceMessageId === admission.sourceMessageId;
}

export function scopeAllows(scope: MemoryScope | null, basis: MemoryBasis): boolean {
  return (scope?.memoryEpoch ?? 0) === basis.memoryEpoch &&
    (!scope || (ownsScope(scope, basis.key) && basis.inputSeq > scope.purgedThroughSeq));
}

export function offerCurrent(offer: MemoryOffer, source: MemorySourceState, key: MemoryScopeKey, now: Date, inputSeq = source.inputSeq): boolean {
  return source.assistantAvailable && ownsSource(source, key) && ownsScope(offer.scope, key) &&
    offer.scopeId === offer.episode.scopeId && offer.memoryEpoch === offer.scope.memoryEpoch &&
    offer.inputSeq === inputSeq && offer.handoffVersion === source.handoffVersion &&
    offer.episodeRevision === offer.episode.revision && offer.contentRevision === offer.episode.contentRevision &&
    offer.episode.status === 'OPEN' && offer.expiresAt > now && offer.episode.expiresAt > now;
}

export function snapshotOf(episode: Pick<MemoryEpisode, 'snapshot' | 'schemaVersion'>) {
  if (episode.schemaVersion !== 1 && episode.schemaVersion !== 2) throw new Error('Unsupported memory snapshot version');
  const snapshot = memorySnapshotSchema.parse(episode.snapshot);
  if (episode.schemaVersion === 1 && snapshot.goalKey !== undefined) throw new Error('Invalid v1 memory snapshot');
  return snapshot as MemorySnapshot;
}

export function episodeView(episode: MemoryEpisode, now: Date) {
  const status = episode.status === 'OPEN' &&
    now.getTime() - episode.lastMeaningfulAt.getTime() >= MEMORY_PAUSE_AFTER_MS ? 'PAUSED' : episode.status;
  const { id, taskKey, type, outcome, revision, contentRevision, lastMeaningfulAt, expiresAt } = episode;
  return { id, taskKey, type, status, outcome, revision, contentRevision, lastMeaningfulAt, expiresAt, snapshot: snapshotOf(episode) };
}
