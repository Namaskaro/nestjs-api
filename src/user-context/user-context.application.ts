
import type {
  ConfirmPreference, PreferenceEvidence, PreferenceEvidenceRef, PreferenceFact, PreferenceKey, UserContextKey,
} from './user-context.contract';
import type { PreferenceCriterionKey, PreferenceValue } from './user-context.contract';

export class UserContextError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'unsupported', message: string) {
    super(message);
  }
}

export interface UserContextScope {
  id: string;
  revision: number;
}

export interface UserContextUnit {
  evidence(key: UserContextKey, reference: PreferenceEvidenceRef, at: Date): Promise<PreferenceEvidence | null>;
  scope(key: UserContextKey, lock: 'share' | 'update', create: boolean): Promise<UserContextScope | null>;
  facts(scopeId: string): Promise<PreferenceFact[]>;
  fact(scopeId: string, preference: PreferenceKey): Promise<PreferenceFact | null>;
  save(scopeId: string, fact: PreferenceFact): Promise<PreferenceFact>;
  delete(scopeId: string, preference?: PreferenceKey): Promise<number>;
  revoke(scopeId: string, source: Omit<PreferenceEvidenceRef, 'episodeRevision' | 'criterion'>, changed?: PreferenceCriterionKey[]): Promise<number>;
  advance(scopeId: string, revision: number): Promise<number>;
}

export interface UserContextRepository {
  transaction<T>(work: (unit: UserContextUnit) => Promise<T>): Promise<T>;
}

export type PreferencePolicy = (preference: PreferenceKey, evidence: PreferenceEvidence,
  criterion: PreferenceCriterionKey) => PreferenceValue | undefined;

function sameEvidence(left: PreferenceEvidenceRef, right: PreferenceEvidenceRef) {
  return left.sourceKind === right.sourceKind && left.sourceKey === right.sourceKey &&
    left.episodeId === right.episodeId && left.episodeRevision === right.episodeRevision &&
    left.criterion.attributeId === right.criterion.attributeId && left.criterion.operator === right.criterion.operator;
}

function checkRevision(scope: UserContextScope, expected: number) {
  if (scope.revision !== expected) throw new UserContextError('conflict', 'Context revision has changed');
}

export class UserContext {
  constructor(
    private readonly repository: UserContextRepository,
    private readonly now: () => Date,
    private readonly policy: PreferencePolicy,
  ) {}

  async get(key: UserContextKey) {
    return this.repository.transaction(async unit => {
      const scope = await unit.scope(key, 'share', false);
      return scope ? { revision: scope.revision, facts: await unit.facts(scope.id) } : { revision: 0, facts: [] };
    });
  }

  async confirm(key: UserContextKey, command: ConfirmPreference) {
    return this.repository.transaction(async unit => {
      const now = this.now();
      const evidence = await unit.evidence(key, command.evidence, now);
      const scope = await unit.scope(key, 'update', true);
      if (!scope) throw new Error('User context scope unavailable after insert');
      const preference = { domainKey: command.domainKey, preferenceKey: command.preferenceKey };
      const prior = await unit.fact(scope.id, preference);
      if (prior?.commandId === command.commandId) {
        if (!sameEvidence(prior.source, command.evidence)) throw new UserContextError('conflict', 'Command ID is already used');
        return { revision: scope.revision, fact: prior };
      }
      checkRevision(scope, command.expectedRevision);
      if (!evidence) throw new UserContextError('not_found', 'Episode is unavailable');
      if (evidence.revision !== command.evidence.episodeRevision) throw new UserContextError('conflict', 'Episode revision has changed');
      const value = this.policy(preference, evidence, command.evidence.criterion);
      if (value === undefined) throw new UserContextError('unsupported', 'Criterion cannot be confirmed as a preference');
      const fact = await unit.save(scope.id, {
        ...preference, value, commandId: command.commandId, confirmation: 'CONFIRMED', source: command.evidence,
        observedAt: evidence.observedAt, confirmedAt: now, updatedAt: now,
      });
      return { revision: await unit.advance(scope.id, scope.revision), fact };
    });
  }

  async remove(key: UserContextKey, expectedRevision: number, preference?: PreferenceKey) {
    return this.repository.transaction(async unit => {
      const scope = await unit.scope(key, 'update', true);
      if (!scope) throw new Error('User context scope unavailable after insert');
      checkRevision(scope, expectedRevision);
      await unit.delete(scope.id, preference);
      return { revision: await unit.advance(scope.id, scope.revision) };
    });
  }
}

export async function revokeEpisodePreferences(
  unit: UserContextUnit, key: UserContextKey,
  source: Omit<PreferenceEvidenceRef, 'episodeRevision' | 'criterion'>, changed?: PreferenceCriterionKey[],
) {
  if (changed?.length === 0) return;
  const scope = await unit.scope(key, 'update', false);
  if (scope && await unit.revoke(scope.id, source, changed)) await unit.advance(scope.id, scope.revision);
}
