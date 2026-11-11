
import { randomUUID } from 'node:crypto';
import { Prisma, type UserContextFact as FactRow } from '@prisma/generated';
import type { PrismaService } from '@/src/core/prisma/prisma.service';
import type { PrismaMemoryRepository } from '@/src/consultation-memory/prisma-memory.repository';
import { ownsScope, ownsSource, snapshotOf } from '@/src/consultation-memory/memory.policies';
import type { PreferenceFact } from './user-context.contract';
import type { UserContextRepository, UserContextScope, UserContextUnit } from './user-context.application';

function mapFact(row: FactRow): PreferenceFact {
  const { value, confirmation, sourceOperator: operator } = row;
  if ((typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') ||
      confirmation !== 'CONFIRMED' || !['eq', 'contains', 'lte', 'gte'].includes(operator)) {
    throw new Error('Unsupported stored preference');
  }
  return {
    domainKey: row.domainKey, preferenceKey: row.preferenceKey, value, confirmation,
    commandId: row.commandId, observedAt: row.observedAt, confirmedAt: row.confirmedAt, updatedAt: row.updatedAt,
    source: {
      sourceKind: row.sourceKind, sourceKey: row.sourceKey, episodeId: row.sourceEpisodeId,
      episodeRevision: row.sourceEpisodeRevision, criterion: {
        attributeId: row.sourceAttributeId, operator: operator as PreferenceFact['source']['criterion']['operator'],
      },
    },
  };
}

export class PrismaUserContextRepository implements UserContextRepository {
  constructor(private readonly prisma: PrismaService, private readonly memory: PrismaMemoryRepository) {}

  transaction<T>(work: (unit: UserContextUnit) => Promise<T>) {
    return this.prisma.$transaction(tx => work(this.bind(tx)), { maxWait: 1000, timeout: 3000 });
  }

  bind(tx: Prisma.TransactionClient): UserContextUnit {
    return {
      evidence: async (key, reference, at) => {
        const memory = this.memory.bind(tx);
        const sourceKey = { ...key, sourceKind: reference.sourceKind, sourceKey: reference.sourceKey };
        if (!ownsSource(await memory.sourceState(sourceKey, true), sourceKey)) return null;
        const scope = await memory.getScope(sourceKey);
        if (!scope || !ownsScope(scope, sourceKey)) return null;
        const [episode] = await memory.episodes(scope.id, { ids: [reference.episodeId], liveAt: at });
        if (!episode) return null;
        const { profileId, constraints } = snapshotOf(episode);
        return { revision: episode.revision, profileId, criteria: constraints, observedAt: episode.lastMeaningfulAt };
      },
      scope: async ({ storeKey, subjectKey }, lock, create) => {
        if (create) {
          await tx.$executeRaw`
            INSERT INTO "UserContextScope" ("id", "storeKey", "subjectKey")
            VALUES (${randomUUID()}, ${storeKey}, ${subjectKey})
            ON CONFLICT ("storeKey", "subjectKey") DO NOTHING
          `;
        }
        const lockMode = lock === 'update' ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
        const [row] = await tx.$queryRaw<UserContextScope[]>`
          SELECT id, revision FROM "UserContextScope"
          WHERE "storeKey" = ${storeKey} AND "subjectKey" = ${subjectKey}
          ${lockMode}
        `;
        return row ?? null;
      },
      facts: async scopeId => (await tx.userContextFact.findMany({
        where: { scopeId }, orderBy: [{ domainKey: 'asc' }, { preferenceKey: 'asc' }],
      })).map(mapFact),
      fact: async (scopeId, preference) => {
        const row = await tx.userContextFact.findUnique({
          where: { scopeId_domainKey_preferenceKey: { scopeId, ...preference } },
        });
        return row ? mapFact(row) : null;
      },
      save: async (scopeId, fact) => {
        const { domainKey, preferenceKey, source, ...fields } = fact;
        const data = {
          ...fields, sourceKind: source.sourceKind, sourceKey: source.sourceKey, sourceEpisodeId: source.episodeId,
          sourceEpisodeRevision: source.episodeRevision, sourceAttributeId: source.criterion.attributeId,
          sourceOperator: source.criterion.operator,
        };
        return mapFact(await tx.userContextFact.upsert({
          where: { scopeId_domainKey_preferenceKey: { scopeId, domainKey, preferenceKey } },
          create: { scopeId, domainKey, preferenceKey, ...data }, update: data,
        }));
      },
      delete: async (scopeId, preference) => (await tx.userContextFact.deleteMany({ where: { scopeId, ...preference } })).count,
      revoke: async (scopeId, source, changed) => (await tx.userContextFact.deleteMany({
        where: {
          scopeId, sourceKind: source.sourceKind, sourceKey: source.sourceKey, sourceEpisodeId: source.episodeId,
          ...(changed ? { OR: changed.map(key => ({ sourceAttributeId: key.attributeId, sourceOperator: key.operator })) } : {}),
        },
      })).count,
      advance: async (id, revision) => (await tx.userContextScope.update({
        where: { id, revision }, data: { revision: { increment: 1 } }, select: { revision: true },
      })).revision,
    };
  }
}
