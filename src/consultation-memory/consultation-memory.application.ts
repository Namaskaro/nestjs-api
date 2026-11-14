
import {
  applyEpisodeChange, memoryCandidateSchema, memoryCorrectionSchema, MEMORY_DAY_MS,
  MEMORY_OFFER_AFTER_MS, MEMORY_RETENTION_MS,
} from './consultation-memory.core';
import type { ConsultationMemoryCandidate } from './memory.contract';
import type {
  MemoryAdmission, MemoryBasis, MemoryContinuation, MemoryEpisode, MemoryOffer, MemoryRepository,
  MemoryScopeKey, MemorySourceState, MemoryUnit, ResumeDecision,
} from './memory.port';
import { currentAdmission, episodeView, offerCurrent, ownsScope, ownsSource, scopeAllows, snapshotOf } from './memory.policies';

export class MemoryError extends Error {
  constructor(readonly code: 'not_found' | 'conflict', message: string) {
    super(message);
  }
}

const unavailable = () => new MemoryError('not_found', 'Offer is unavailable');
const conflict = () => new MemoryError('conflict', 'Offer is no longer current');
const stale = () => new MemoryError('conflict', 'Memory changed during the assistant run');

function continuationView(episode: MemoryEpisode): MemoryContinuation {
  const { profileId, goalKey, constraints, lastSourceMessageId } = snapshotOf(episode);
  return {
    episodeId: episode.id, taskKey: episode.taskKey, revision: episode.revision,
    snapshot: { profileId, ...(goalKey === undefined ? {} : { goalKey }), constraints, lastSourceMessageId },
  };
}

function offerCriteria(episode: MemoryEpisode) {
  const { profileId, goalKey, constraints } = snapshotOf(episode);
  return { profileId, ...(goalKey === undefined ? {} : { goalKey }), constraints };
}

async function requireOwner(unit: MemoryUnit, key: MemoryScopeKey, lock: boolean) {
  const source = await unit.sourceState(key, lock);
  if (!ownsSource(source, key)) throw new MemoryError('not_found', 'Episodes were not found');
  return source;
}

async function consumedOffer(
  unit: MemoryUnit, scopeId: string, admission: MemoryAdmission, offerId: string | undefined,
) {
  if (!offerId) return null;
  const offer = await unit.getOffer(offerId);
  return offer && offer.scopeId === scopeId && offer.inputSeq === admission.inputSeq - 1 &&
    offer.decision === 'continue' && offer.consumedAt ? offer : null;
}

export class ConsultationMemory {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly now: () => Date,
    private readonly fingerprint: (candidate: unknown) => string,
    private readonly writeVersion: () => 1 | 2,
  ) {}

  async getResumeOffer(key: MemoryScopeKey) {
    return (await this.getResumeState(key)).consultationOffer;
  }

  async getResumeState(key: MemoryScopeKey) {
    const empty = { consultationOffer: null, consultationIntent: null };
    return this.repository.transaction(async unit => {
      const source = await unit.sourceState(key, true);
      if (!ownsSource(source, key) || !source.assistantAvailable) return empty;
      if (source.nextIntent) return { consultationOffer: null, consultationIntent: source.nextIntent };
      const now = this.now();
      const scope = await unit.getScope(key);
      if (!scope || !ownsScope(scope, key) || (scope.offerSuppressedUntil && scope.offerSuppressedUntil > now)) return empty;
      if (source.sourceMessageId && !await unit.hasReply(key, source.sourceMessageId)) return empty;
      const [episode] = await unit.episodes(scope.id, {
        open: true, liveAt: now, inactiveSince: new Date(now.getTime() - MEMORY_OFFER_AFTER_MS), limit: 1,
      });
      if (!episode) return empty;
      const offer = await unit.episodeOffer(episode.id, episode.contentRevision) ?? await unit.addOffer({
        scopeId: scope.id, episodeId: episode.id, episodeRevision: episode.revision,
        contentRevision: episode.contentRevision, memoryEpoch: scope.memoryEpoch,
        inputSeq: source.inputSeq, handoffVersion: source.handoffVersion,
        expiresAt: new Date(Math.min(now.getTime() + MEMORY_DAY_MS, episode.expiresAt.getTime())),
      });
      if (!offerCurrent(offer, source, key, now) || offer.consumedAt ||
          offer.decision === 'later' || offer.decision === 'start_new') return empty;
      return {
        consultationIntent: null,
        consultationOffer: {
          offerId: offer.id, expiresAt: offer.expiresAt, serverNow: now,
          state: offer.decision === 'continue' ? 'continued' as const : 'pending' as const,
          criteria: offerCriteria(episode),
        },
      };
    });
  }

  async decideResumeOffer(key: MemoryScopeKey, offerId: string, decision: ResumeDecision) {
    return this.repository.transaction(async unit => {
      const source = await requireOwner(unit, key, true);
      const offer = await unit.getOffer(offerId);
      const now = this.now();
      if (!offer || !ownsScope(offer.scope, key)) throw unavailable();
      const switchingToNew = decision === 'start_new' && offer.decision === 'continue';
      if (!offerCurrent(offer, source, key, now) || offer.consumedAt ||
          (decision === 'start_new' && !switchingToNew && offer.decision !== 'start_new') ||
          (offer.decision && offer.decision !== decision && !switchingToNew)) throw conflict();
      if (switchingToNew) await unit.markStartNew(key, source);
      if (!offer.decision || switchingToNew) {
        await unit.updateOffer(offer.id, { decision, decidedAt: now });
        if (decision === 'later') {
          await unit.updateScope(offer.scopeId, { offerSuppressedUntil: new Date(now.getTime() + MEMORY_OFFER_AFTER_MS) });
        }
      }
      return decision === 'continue' ? {
        decision, continuationOfferId: offer.id, criteria: offerCriteria(offer.episode),
      } : { decision };
    });
  }

  async consumeResumeOffer(unit: MemoryUnit, key: MemoryScopeKey, offerId: string) {
    const source = await unit.sourceState(key, true);
    if (!ownsSource(source, key)) throw unavailable();
    const offer = await unit.getOffer(offerId);
    const now = this.now();
    if (!offer || !ownsScope(offer.scope, key)) throw unavailable();
    if (!offerCurrent(offer, source, key, now) || offer.decision !== 'continue' || offer.consumedAt) throw conflict();
    const continuation = continuationView(offer.episode);
    await unit.updateOffer(offer.id, { consumedAt: now });
    return continuation;
  }

  async getBasis(admission: MemoryAdmission): Promise<MemoryBasis | null> {
    const unit = this.repository.read;
    const source = await unit.sourceState(admission.key, false);
    if (!currentAdmission(source, admission)) return null;
    const now = this.now();
    const scope = await unit.getScope(admission.key);
    if (scope && (!ownsScope(scope, admission.key) || admission.inputSeq <= scope.purgedThroughSeq)) return null;
    const input = await unit.sourceInput(admission);
    if (!input) return null;
    const episodes = scope ? await unit.episodes(scope.id, { open: true, liveAt: now }) : [];
    const offer = scope ? await consumedOffer(unit, scope.id, admission, input.offerId) : null;
    const continuation = offer && offerCurrent(offer, source, admission.key, now, admission.inputSeq - 1)
      ? continuationView(offer.episode) : undefined;
    return {
      ...admission, memoryEpoch: scope?.memoryEpoch ?? 0,
      revisions: Object.fromEntries(episodes.map(({ taskKey, revision }) => [taskKey, revision])),
      witnesses: Object.fromEntries(episodes.map(episode => [episode.id, {
        revision: episode.revision, sourceMessageId: snapshotOf(episode).lastSourceMessageId,
      }])),
      ...(continuation ? { continuation } : {}),
    };
  }

  async verifyReplyCurrent(basis: MemoryBasis) {
    return this.repository.transaction(unit => this.assertReplyCurrent(unit, basis));
  }

  async assertReplyCurrent(unit: MemoryUnit, basis: MemoryBasis) {
    const source = await unit.sourceState(basis.key, true);
    if (!currentAdmission(source, basis)) throw stale();
    const scope = await unit.getScope(basis.key);
    if (!scope || !scopeAllows(scope, basis)) throw stale();
    const input = await unit.sourceInput(basis);
    if (!input) throw stale();
    const now = this.now();
    const ids = Object.keys(basis.witnesses);
    const rows = await unit.episodes(scope.id, { ids, open: true, liveAt: now });
    if (rows.length !== ids.length || rows.some(episode => {
      const expected = basis.witnesses[episode.id];
      return episode.revision !== expected.revision || snapshotOf(episode).lastSourceMessageId !== expected.sourceMessageId;
    })) throw stale();
    if (basis.continuation) {
      const offer = await consumedOffer(unit, scope.id, basis, input.offerId);
      if (!offer || offer.episode.id !== basis.continuation.episodeId ||
          !offerCurrent(offer, source, basis.key, now, basis.inputSeq - 1)) throw stale();
    }
  }

  async project(basis: MemoryBasis, assistantMessageId: string, raw: ConsultationMemoryCandidate) {
    const candidate = memoryCandidateSchema.parse(raw);
    if (candidate.sourceMessageId !== basis.sourceMessageId) return 'STALE' as const;
    if (!candidate.changes.length) return 'EMPTY' as const;
    const payloadHash = this.fingerprint(candidate);
    return this.repository.transaction(async unit => {
      const source = await unit.sourceState(basis.key, true);
      if (!currentAdmission(source, basis)) return 'STALE' as const;
      const input = await unit.sourceInput(basis);
      if (!input || !await unit.hasReply(basis.key, basis.sourceMessageId, assistantMessageId)) return 'STALE' as const;
      const existingScope = await unit.getScope(basis.key);
      if (!scopeAllows(existingScope, basis)) return 'STALE' as const;
      if (existingScope) {
        const receipt = await unit.receipt(existingScope.id, basis.sourceMessageId);
        if (receipt) return receipt.payloadHash === payloadHash && receipt.assistantMessageId === assistantMessageId
          ? 'DUPLICATE' as const : 'STALE' as const;
      }
      const now = this.now();
      const offer = basis.continuation && existingScope ? await consumedOffer(unit, existingScope.id, basis, input.offerId) : null;
      const rows = existingScope ? await unit.episodes(existingScope.id, { tasks: candidate.changes.map(change => change.taskKey) }) : [];
      const byTask = new Map(rows.map(episode => [episode.taskKey, episode]));
      const updates = [];
      for (const change of candidate.changes) {
        const previous = byTask.get(change.taskKey) ?? null;
        if (change.kind === 'start' ? Boolean(previous) : !previous || previous.status !== 'OPEN' || previous.expiresAt <= now ||
            !Object.prototype.hasOwnProperty.call(basis.revisions, change.taskKey) || basis.revisions[change.taskKey] !== previous.revision) {
          return 'STALE' as const;
        }
        const snapshot = previous ? snapshotOf(previous) : null;
        const explicitlyResumed = previous && offer && this.matchesResume(offer, previous, basis, source, now) &&
          snapshot.lastSourceMessageId === basis.continuation?.snapshot.lastSourceMessageId;
        if (previous && !explicitlyResumed &&
            (!change.previousSourceMessageId || snapshot.lastSourceMessageId !== change.previousSourceMessageId)) return 'STALE' as const;
        updates.push({ change, previous, ...applyEpisodeChange(snapshot, change, basis.sourceMessageId) });
      }
      const scope = existingScope ?? await unit.addScope(basis.key);
      const expiresAt = new Date(now.getTime() + MEMORY_RETENTION_MS);
      const appliedRevisions: Array<[string, number]> = [];
      for (const { change, previous, snapshot, contentChanged } of updates) {
        const outcome = change.outcome ?? null;
        const schemaVersion = this.versionFor(previous);
        if (schemaVersion === 1 && snapshot.goalKey !== undefined) throw conflict();
        const episode = await unit.writeEpisode(scope.id, change.taskKey, previous, {
          snapshot, schemaVersion, outcome,
          status: outcome ? 'CLOSED' : 'OPEN', closedAt: outcome ? now : null, lastMeaningfulAt: now, expiresAt,
        }, contentChanged || Boolean(outcome));
        appliedRevisions.push([episode.taskKey, episode.revision]);
      }
      await unit.addReceipt(scope.id, {
        sourceMessageId: basis.sourceMessageId, assistantMessageId, inputSeq: basis.inputSeq,
        payloadHash, appliedRevisions: Object.fromEntries(appliedRevisions), expiresAt,
      });
      return 'APPLIED' as const;
    });
  }

  async list(key: MemoryScopeKey) {
    const unit = this.repository.read;
    await requireOwner(unit, key, false);
    const scope = await unit.getScope(key);
    const now = this.now();
    return scope && ownsScope(scope, key)
      ? (await unit.episodes(scope.id, { liveAt: now, limit: 100 })).map(episode => episodeView(episode, now)) : [];
  }

  async correct(key: MemoryScopeKey, episodeId: string, revision: number, raw: unknown) {
    const change = memoryCorrectionSchema.parse(raw);
    return this.repository.transaction(async unit => {
      await requireOwner(unit, key, true);
      const scope = await unit.getScope(key);
      const now = this.now();
      const [previous] = scope && ownsScope(scope, key)
        ? await unit.episodes(scope.id, { ids: [episodeId], liveAt: now }) : [];
      if (!previous) throw new MemoryError('not_found', 'Episode was not found');
      if (previous.revision !== revision) throw new MemoryError('conflict', 'Episode has changed');
      const before = snapshotOf(previous);
      const applied = applyEpisodeChange(before, change, null);
      const changed = applied.contentChanged || Boolean(change.outcome && change.outcome !== previous.outcome);
      if (!changed) return episodeView(previous, now);
      const schemaVersion = this.versionFor(previous);
      if (schemaVersion === 1 && applied.snapshot.goalKey !== undefined) throw conflict();
      const next = await unit.writeEpisode(scope.id, previous.taskKey, previous, {
        snapshot: applied.snapshot, schemaVersion,
        outcome: change.outcome ?? previous.outcome, status: change.outcome ? 'CLOSED' : previous.status,
        closedAt: change.outcome ? now : previous.closedAt,
        lastMeaningfulAt: now, expiresAt: new Date(now.getTime() + MEMORY_RETENTION_MS),
      }, true);
      await unit.updateScope(scope.id, { memoryEpoch: scope.memoryEpoch + 1 });
      const changedCriteria = before.profileId !== applied.snapshot.profileId ? undefined : before.constraints
        .filter(criterion => !applied.snapshot.constraints.some(item => item.attributeId === criterion.attributeId &&
          item.operator === criterion.operator && item.value === criterion.value && item.unit === criterion.unit))
        .map(({ attributeId, operator }) => ({ attributeId, operator }));
      await unit.revokeEpisodePreferences?.(key, episodeId, changedCriteria);
      return episodeView(next, now);
    });
  }

  async remove(key: MemoryScopeKey, episodeId: string) {
    await this.repository.transaction(async unit => {
      const source = await requireOwner(unit, key, true);
      const scope = await unit.getScope(key);
      if (scope && ownsScope(scope, key) && await unit.removeEpisode(scope.id, episodeId)) {
        await unit.updateScope(scope.id, { memoryEpoch: scope.memoryEpoch + 1, purgedThroughSeq: source.inputSeq });
        await unit.revokeEpisodePreferences?.(key, episodeId);
      }
    });
  }

  async purgeExpired(storeKey: string) {
    const now = this.now();
    const candidates = await this.repository.expiredEpisodes(storeKey, now);
    let count = 0;
    for (const candidate of candidates) {
      count += await this.repository.transaction(async unit => {
        const source = await unit.sourceState(candidate.scope, true);
        const scope = source && await unit.getScope(candidate.scope);
        if (!scope || !ownsScope(scope, candidate.scope) || !await unit.removeEpisode(scope.id, candidate.id, now)) return 0;
        await unit.updateScope(scope.id, { memoryEpoch: scope.memoryEpoch + 1, purgedThroughSeq: source.inputSeq });
        return 1;
      });
    }
    await this.repository.purgeReceipts(storeKey, now);
    return count;
  }

  private versionFor(previous: MemoryEpisode | null): 1 | 2 {
    return previous?.schemaVersion === 2 ? 2 : this.writeVersion();
  }

  private matchesResume(offer: MemoryOffer, episode: MemoryEpisode, basis: MemoryBasis, source: MemorySourceState, now: Date) {
    return basis.continuation?.episodeId === episode.id && basis.continuation.revision === episode.revision &&
      offer.episode.id === episode.id && offerCurrent(offer, source, basis.key, now, basis.inputSeq - 1);
  }
}
