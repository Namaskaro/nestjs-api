
import { Prisma } from '@prisma/generated';
import type { MemoryConstraintKey } from './memory.contract';
import type { PrismaClient } from '@prisma/generated';
import type {
  EpisodeData, MemoryAdmission, MemoryEpisode, MemoryEpisodeSelection, MemoryOffer, MemoryReceipt,
  MemoryRepository, MemoryScope, MemoryScopeKey, MemorySourceState, MemoryUnit, OfferData, ResumeDecision,
} from './memory.port';

const memoryTransaction = { maxWait: 1000, timeout: 3000 };
const offerInclude = { scope: true, episode: true } as const;
type PrismaOffer = Prisma.ConsultationResumeOfferGetPayload<{ include: typeof offerInclude }>;

export interface PrismaMemorySource {
  state(tx: Prisma.TransactionClient, key: MemoryScopeKey, lock: boolean): Promise<MemorySourceState | null>;
  input(tx: Prisma.TransactionClient, admission: MemoryAdmission): ReturnType<MemoryUnit['sourceInput']>;
  hasReply(tx: Prisma.TransactionClient, key: MemoryScopeKey, inputId: string, replyId?: string): Promise<boolean>;
  markStartNew(tx: Prisma.TransactionClient, key: MemoryScopeKey, source: MemorySourceState): Promise<void>;
  chatLink(key: MemoryScopeKey): string | null;
}

function mapOffer(offer: PrismaOffer | null): MemoryOffer | null {
  if (!offer) return null;
  const { decision } = offer;
  if (decision !== null && decision !== 'continue' && decision !== 'later' && decision !== 'start_new') {
    throw new Error('Unsupported stored offer decision');
  }
  return { ...offer, decision: decision as ResumeDecision | null };
}

function scopeKey({ storeKey, subjectKey, sourceKind, sourceKey }: MemoryScopeKey): MemoryScopeKey {
  return { storeKey, subjectKey, sourceKind, sourceKey };
}

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly source: PrismaMemorySource,
    private readonly revokePreferences?: (
      tx: Prisma.TransactionClient, key: MemoryScopeKey, episodeId: string, changed?: MemoryConstraintKey[],
    ) => Promise<void>,
  ) {}

  get read() {
    return this.bind(this.prisma);
  }

  bind(tx: Prisma.TransactionClient): MemoryUnit {
    return {
      sourceState: (key, lock) => this.source.state(tx, key, lock),
      sourceInput: admission => this.source.input(tx, admission),
      hasReply: (key, inputId, replyId) => this.source.hasReply(tx, key, inputId, replyId),
      markStartNew: (key, source) => this.source.markStartNew(tx, key, source),
      getScope: key => tx.consultationMemoryScope.findUnique({
        where: { storeKey_subjectKey_sourceKind_sourceKey: scopeKey(key) },
      }),
      addScope: key => tx.consultationMemoryScope.create({
        data: { ...scopeKey(key), chatId: this.source.chatLink(key) },
      }),
      updateScope: async (id, data) => { await tx.consultationMemoryScope.update({ where: { id }, data }); },
      episodes: (scopeId, selection) => this.episodes(tx, scopeId, selection),
      writeEpisode: (scopeId, taskKey, previous, data, changed) => this.writeEpisode(tx, scopeId, taskKey, previous, data, changed),
      ...(this.revokePreferences ? {
        revokeEpisodePreferences: (key, episodeId, changed) => this.revokePreferences(tx, key, episodeId, changed),
      } : {}),
      removeEpisode: async (scopeId, id, expiresAt) => Boolean((await tx.consultationEpisode.deleteMany({
        where: { scopeId, id, ...(expiresAt ? { expiresAt: { lte: expiresAt } } : {}) },
      })).count),
      getOffer: async id => mapOffer(await tx.consultationResumeOffer.findUnique({ where: { id }, include: offerInclude })),
      episodeOffer: async (episodeId, contentRevision) => mapOffer(await tx.consultationResumeOffer.findUnique({
        where: { episodeId_contentRevision: { episodeId, contentRevision } }, include: offerInclude,
      })),
      addOffer: async data => mapOffer(await tx.consultationResumeOffer.create({ data, include: offerInclude })),
      updateOffer: async (id, data) => { await tx.consultationResumeOffer.update({ where: { id }, data }); },
      receipt: (scopeId, sourceMessageId) => tx.consultationTurnReceipt.findUnique({
        where: { scopeId_sourceMessageId: { scopeId, sourceMessageId } },
        select: { payloadHash: true, assistantMessageId: true },
      }),
      addReceipt: async (scopeId, receipt) => { await tx.consultationTurnReceipt.create({ data: { scopeId, ...receipt } }); },
    };
  }

  transaction<T>(operation: (unit: MemoryUnit) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(tx => operation(this.bind(tx)), memoryTransaction);
  }

  async expiredEpisodes(storeKey: string, now: Date) {
    return this.prisma.consultationEpisode.findMany({
      where: { scope: { storeKey }, expiresAt: { lte: now } },
      select: { id: true, scope: true }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take: 1000,
    });
  }

  async purgeReceipts(storeKey: string, now: Date) {
    await this.prisma.consultationTurnReceipt.deleteMany({ where: { scope: { storeKey }, expiresAt: { lte: now } } });
  }

  private episodes(tx: Prisma.TransactionClient, scopeId: string, selection: MemoryEpisodeSelection) {
    const { ids, tasks, open, liveAt, inactiveSince, limit } = selection;
    return tx.consultationEpisode.findMany({
      where: {
        scopeId,
        ...(ids ? { id: { in: ids } } : {}),
        ...(tasks ? { taskKey: { in: tasks } } : {}),
        ...(open ? { status: 'OPEN' } : {}),
        ...(liveAt ? { expiresAt: { gt: liveAt } } : {}),
        ...(inactiveSince ? { lastMeaningfulAt: { lte: inactiveSince } } : {}),
      },
      orderBy: [{ lastMeaningfulAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }

  private writeEpisode(
    tx: Prisma.TransactionClient, scopeId: string, taskKey: string, previous: MemoryEpisode | null,
    data: EpisodeData, changed: boolean,
  ) {
    const row = { ...data, snapshot: data.snapshot as unknown as Prisma.InputJsonValue };
    return previous ? tx.consultationEpisode.update({
      where: { id: previous.id, scopeId, revision: previous.revision },
      data: { ...row, revision: { increment: 1 }, contentRevision: { increment: changed ? 1 : 0 } },
    }) : tx.consultationEpisode.create({ data: { scopeId, taskKey, ...row } });
  }
}
