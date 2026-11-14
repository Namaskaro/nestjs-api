import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/generated';
import { UserContext, revokeEpisodePreferences, type PreferencePolicy } from '../user-context/user-context.application';
import { PrismaUserContextRepository } from '../user-context/prisma-user-context.repository';
import { ConsultationMemory } from './consultation-memory.application';
import { PrismaMemoryRepository, type PrismaMemorySource } from './prisma-memory.repository';

export interface PostgresMemoryRuntimeOptions {
  prisma: PrismaClient;
  source: PrismaMemorySource;
  preferencePolicy: PreferencePolicy;
  now: () => Date;
  writeVersion: () => 1 | 2;
}

export function createPostgresMemoryRuntime({
  prisma, source, preferencePolicy, now, writeVersion,
}: PostgresMemoryRuntimeOptions) {
  const evidenceRepository = new PrismaMemoryRepository(prisma, source);
  const contextRepository = new PrismaUserContextRepository(prisma, evidenceRepository);
  const memoryRepository = new PrismaMemoryRepository(prisma, source, (tx, key, episodeId, changed) =>
    revokeEpisodePreferences(contextRepository.bind(tx), key, {
      sourceKind: key.sourceKind, sourceKey: key.sourceKey, episodeId,
    }, changed));
  return {
    memory: new ConsultationMemory(memoryRepository, now,
      candidate => createHash('sha256').update(JSON.stringify(candidate)).digest('hex'), writeVersion),
    userContext: new UserContext(contextRepository, now, preferencePolicy),
    memoryRepository,
  };
}
