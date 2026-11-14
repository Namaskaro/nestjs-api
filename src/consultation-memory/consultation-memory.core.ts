import { z } from 'zod';
import type { MemoryConstraint } from './memory.contract';

const ref = z.string().trim().min(1).max(160);
const key = z.object({
  attributeId: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/),
  operator: z.enum(['eq', 'contains', 'lte', 'gte']),
});
const constraint = key.extend({
  value: z.union([z.string().trim().min(1).max(120), z.number().finite(), z.boolean()]),
  unit: z.string().trim().min(1).max(24).nullable(),
});

const criteria = z.object({
  profileId: ref.nullable().optional(),
  goalKey: ref.nullable().optional(),
  set: z.array(constraint).max(24).optional(),
  clear: z.array(key).max(24).optional(),
}).strict();
const outcome = z.enum(['PRODUCT_SELECTED', 'NO_MATCH', 'USER_CANCELLED', 'FINISHED_UNSPECIFIED']);
export const memoryCorrectionSchema = z.object({
  criteria: criteria.optional(),
  outcome: outcome.optional(),
}).strict().refine((value) => Boolean(value.criteria || value.outcome));

const changeSchema = z.object({
  taskKey: ref,
  kind: z.enum(['start', 'update']),
  previousSourceMessageId: ref.optional(),
  criteria: criteria.optional(),
  considered: z.array(ref).max(20).optional(),
  compared: z.array(ref).max(20).optional(),
  recommended: z.array(ref).max(5).optional(),
  outcome: outcome.optional(),
}).strict();
export const memoryCandidateSchema = z.object({
  sourceMessageId: ref,
  changes: z.array(changeSchema).max(12),
}).strict().refine(({ changes }) => new Set(changes.map((item) => item.taskKey)).size === changes.length);

export const memorySnapshotSchema = z.object({
  profileId: ref.nullable(),
  goalKey: ref.nullable().optional(),
  constraints: z.array(constraint).max(24),
  considered: z.array(ref).max(20),
  compared: z.array(ref).max(20),
  recommended: z.array(ref).max(5),
  lastSourceMessageId: ref.nullable(),
}).strict();
export interface MemorySnapshot {
  profileId: string | null;
  goalKey?: string | null;
  constraints: MemoryConstraint[];
  considered: string[];
  compared: string[];
  recommended: string[];
  lastSourceMessageId: string | null;
}

export const MEMORY_DAY_MS = 86_400_000;
export const MEMORY_RETENTION_MS = 90 * MEMORY_DAY_MS;
export const MEMORY_OFFER_AFTER_MS = 7 * MEMORY_DAY_MS;
export const MEMORY_PAUSE_AFTER_MS = 14 * MEMORY_DAY_MS;

const emptySnapshot: MemorySnapshot = {
  profileId: null, constraints: [], considered: [], compared: [], recommended: [], lastSourceMessageId: null,
};

function constraintKey({ attributeId, operator }: { attributeId: string; operator: string }) {
  return attributeId + ':' + operator;
}

export function applyEpisodeChange(
  previous: MemorySnapshot | null,
  change: Pick<z.infer<typeof changeSchema>, 'criteria' | 'considered' | 'compared' | 'recommended'>,
  sourceMessageId: string | null,
) {
  const old = previous ?? emptySnapshot;
  const constraints = new Map<string, MemorySnapshot['constraints'][number]>(old.constraints.map((value) => [constraintKey(value), value]));
  for (const cleared of change.criteria?.clear ?? []) constraints.delete(constraintKey(cleared));
  for (const value of change.criteria?.set ?? []) constraints.set(constraintKey(value), value as MemoryConstraint);

  const next = memorySnapshotSchema.parse({
    profileId: change.criteria?.profileId === undefined ? old.profileId : change.criteria.profileId,
    ...(change.criteria?.goalKey !== undefined ? { goalKey: change.criteria.goalKey } : old.goalKey !== undefined ? { goalKey: old.goalKey } : {}),
    constraints: [...constraints.values()].sort((a, b) => constraintKey(a).localeCompare(constraintKey(b))),
    considered: [...new Set([...(change.considered ?? []), ...old.considered])].slice(0, 20),
    compared: change.compared ? [...new Set(change.compared)] : old.compared,
    recommended: change.recommended ? [...new Set(change.recommended)] : old.recommended,
    lastSourceMessageId: sourceMessageId,
  });
  const { lastSourceMessageId: ignoredOld, ...oldContent } = old;
  const { lastSourceMessageId: ignoredNew, ...newContent } = next;
  return { snapshot: next as MemorySnapshot, contentChanged: JSON.stringify(oldContent) !== JSON.stringify(newContent) };
}
