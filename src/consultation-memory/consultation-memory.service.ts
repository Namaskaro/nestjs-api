import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import {
  ChatMode, ConversationMessageRole, Prisma, Role, type ConsultationEpisode,
} from '@prisma/generated';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import {
  applyEpisodeChange, memoryCandidateSchema, memoryCorrectionSchema, memorySnapshotSchema,
  MEMORY_DAY_MS, MEMORY_RETENTION_MS,
} from './consultation-memory.core';
import type {
  ConsultationMemoryAdmission, ConsultationMemoryBasis, ConsultationMemoryCandidate,
} from './consultation-memory.types';

export const CONSULTATION_MEMORY_CLOCK = Symbol('CONSULTATION_MEMORY_CLOCK');
const memoryTransaction = { maxWait: 1000, timeout: 3000 };
const memoryChatSelect = {
  id: true, userId: true, mode: true, operatorId: true, handoffVersion: true,
  consultationInputSeq: true, consultationAttemptId: true, consultationSourceMessageId: true,
  user: { select: { role: true } },
} satisfies Prisma.ChatSelect;
type MemoryChat = Prisma.ChatGetPayload<{ select: typeof memoryChatSelect }>;

function currentAdmission(chat: MemoryChat | null, source: ConsultationMemoryAdmission) {
  return chat?.userId === source.userId && chat.user.role === Role.Client &&
    chat.mode === ChatMode.BOT && chat.operatorId === null && chat.handoffVersion === source.handoffVersion &&
    chat.consultationInputSeq === source.inputSeq && chat.consultationAttemptId === source.attemptId &&
    chat.consultationSourceMessageId === source.sourceMessageId;
}

function episodeView(episode: ConsultationEpisode, now: Date) {
  const status = episode.status === 'OPEN' &&
    now.getTime() - episode.lastMeaningfulAt.getTime() >= 14 * MEMORY_DAY_MS ? 'PAUSED' : episode.status;
  return {
    id: episode.id, taskKey: episode.taskKey, type: episode.type, status, outcome: episode.outcome,
    revision: episode.revision, contentRevision: episode.contentRevision,
    snapshot: memorySnapshotSchema.parse(episode.snapshot),
    lastMeaningfulAt: episode.lastMeaningfulAt, expiresAt: episode.expiresAt,
  };
}

@Injectable()
export class ConsultationMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(CONSULTATION_MEMORY_CLOCK) private readonly clock: () => Date = () => new Date(),
  ) {}

  private get storeKey() {
    const key = process.env.CONSULTATION_MEMORY_STORE_KEY?.trim();
    return key && /^[a-zA-Z0-9_-]{1,80}$/.test(key) ? key : null;
  }

  get enabled() {
    return process.env.CONSULTATION_MEMORY_ENABLED === '1' && Boolean(this.storeKey);
  }

  private scopeWhere(chatId: string, storeKey: string) {
    return { storeKey_chatId: { storeKey, chatId } };
  }

  private async lockChat(tx: Prisma.TransactionClient, chatId: string) {
    await tx.$queryRaw`SELECT id FROM "Chat" WHERE id = ${chatId} FOR UPDATE`;
    return tx.chat.findUnique({ where: { id: chatId }, select: memoryChatSelect });
  }

  private assertOwner(chat: MemoryChat | null, userId: string) {
    if (!chat || chat.userId !== userId || chat.user.role !== Role.Client) {
      throw new NotFoundException('Подборы не найдены.');
    }
  }

  async getBasis(source: ConsultationMemoryAdmission): Promise<ConsultationMemoryBasis | null> {
    const storeKey = this.storeKey;
    if (!storeKey || !this.enabled) return null;
    const chat = await this.prisma.chat.findUnique({ where: { id: source.chatId }, select: memoryChatSelect });
    if (!currentAdmission(chat, source)) return null;
    const scope = await this.prisma.consultationMemoryScope.findUnique({
      where: this.scopeWhere(source.chatId, storeKey),
      include: { episodes: {
        where: { status: 'OPEN', expiresAt: { gt: this.clock() } },
        select: { taskKey: true, revision: true },
      } },
    });
    if (scope && (scope.subjectKey !== source.userId || source.inputSeq <= scope.purgedThroughSeq)) return null;
    return {
      ...source,
      storeKey,
      memoryEpoch: scope?.memoryEpoch ?? 0,
      revisions: Object.fromEntries((scope?.episodes ?? []).map(({ taskKey, revision }) => [taskKey, revision])),
    };
  }

  async project(basis: ConsultationMemoryBasis, assistantMessageId: string, raw: ConsultationMemoryCandidate) {
    if (!this.enabled || this.storeKey !== basis.storeKey) return 'STALE' as const;
    const candidate = memoryCandidateSchema.parse(raw);
    if (candidate.sourceMessageId !== basis.sourceMessageId) return 'STALE' as const;
    if (!candidate.changes.length) return 'EMPTY' as const;
    const payloadHash = createHash('sha256').update(JSON.stringify(candidate)).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const chat = await this.lockChat(tx, basis.chatId);
      if (!currentAdmission(chat, basis)) return 'STALE' as const;
      const messages = await tx.message.findMany({
        where: { chatId: basis.chatId, id: { in: [basis.sourceMessageId, assistantMessageId] } },
        select: { id: true, authorId: true, role: true, consultationInputSeq: true,
          assistantSourceMessageId: true, expectsEpisodeProjection: true },
      });
      const source = messages.find(({ id }) => id === basis.sourceMessageId);
      const assistant = messages.find(({ id }) => id === assistantMessageId);
      if (source?.role !== ConversationMessageRole.USER || source.authorId !== basis.userId ||
          source.consultationInputSeq !== basis.inputSeq || assistant?.role !== ConversationMessageRole.ASSISTANT ||
          assistant.assistantSourceMessageId !== source.id || !assistant.expectsEpisodeProjection) return 'STALE' as const;

      const scopeWhere = this.scopeWhere(basis.chatId, basis.storeKey);
      const currentScope = await tx.consultationMemoryScope.findUnique({ where: scopeWhere });
      if ((currentScope?.memoryEpoch ?? 0) !== basis.memoryEpoch ||
          (currentScope && (currentScope.subjectKey !== basis.userId || basis.inputSeq <= currentScope.purgedThroughSeq))) {
        return 'STALE' as const;
      }
      if (currentScope) {
        const receipt = await tx.consultationTurnReceipt.findUnique({
          where: { scopeId_sourceMessageId: { scopeId: currentScope.id, sourceMessageId: source.id } },
        });
        if (receipt) return receipt.payloadHash === payloadHash && receipt.assistantMessageId === assistant.id
          ? 'DUPLICATE' as const : 'STALE' as const;
      }

      const now = this.clock();
      const existing = currentScope ? await tx.consultationEpisode.findMany({
        where: { scopeId: currentScope.id, taskKey: { in: candidate.changes.map(({ taskKey }) => taskKey) } },
      }) : [];
      const byTask = new Map(existing.map((episode) => [episode.taskKey, episode]));
      const updates = [];
      for (const change of candidate.changes) {
        const previous = byTask.get(change.taskKey);
        if (change.kind === 'start' ? Boolean(previous) :
          !previous || previous.status !== 'OPEN' || previous.expiresAt <= now ||
          !Object.prototype.hasOwnProperty.call(basis.revisions, change.taskKey) || basis.revisions[change.taskKey] !== previous.revision) {
          return 'STALE' as const;
        }
        const snapshot = previous ? memorySnapshotSchema.parse(previous.snapshot) : null;
        if (previous && (!change.previousSourceMessageId || snapshot.lastSourceMessageId !== change.previousSourceMessageId)) {
          return 'STALE' as const;
        }
        const applied = applyEpisodeChange(snapshot, change, source.id);
        updates.push({ change, previous, ...applied });
      }

      const scope = currentScope ?? await tx.consultationMemoryScope.create({
        data: { storeKey: basis.storeKey, subjectKey: basis.userId, sourceKind: 'CHAT',
          sourceKey: basis.chatId, chatId: basis.chatId },
      });
      const expiry = new Date(now.getTime() + MEMORY_RETENTION_MS);
      const appliedRevisions: Array<[string, number]> = [];
      for (const { change, previous, snapshot, contentChanged } of updates) {
        const outcome = change.outcome ?? null;
        const meaningful = !previous || contentChanged || Boolean(outcome);
        const data = {
          snapshot, outcome, status: outcome ? 'CLOSED' as const : 'OPEN' as const, closedAt: outcome ? now : null,
          lastMeaningfulAt: now,
          expiresAt: expiry,
        };
        const episode = previous ? await tx.consultationEpisode.update({
          where: { id: previous.id, revision: previous.revision },
          data: { ...data, revision: { increment: 1 }, contentRevision: { increment: meaningful ? 1 : 0 } },
        }) : await tx.consultationEpisode.create({
          data: { ...data, taskKey: change.taskKey, scopeId: scope.id },
        });
        appliedRevisions.push([episode.taskKey, episode.revision]);
      }
      await tx.consultationTurnReceipt.create({
        data: { scopeId: scope.id, sourceMessageId: source.id, assistantMessageId: assistant.id,
          inputSeq: basis.inputSeq, payloadHash, appliedRevisions: Object.fromEntries(appliedRevisions), expiresAt: expiry },
      });
      return 'APPLIED' as const;
    }, memoryTransaction);
  }

  async list(chatId: string, userId: string) {
    const storeKey = this.storeKey;
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, select: memoryChatSelect });
    this.assertOwner(chat, userId);
    if (!storeKey) return [];
    const now = this.clock();
    const episodes = await this.prisma.consultationEpisode.findMany({
      where: { scope: { chatId, storeKey, subjectKey: userId }, expiresAt: { gt: now } },
      orderBy: [{ lastMeaningfulAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    return episodes.map((episode) => episodeView(episode, now));
  }

  async correct(chatId: string, userId: string, episodeId: string, revision: number, raw: unknown) {
    const change = memoryCorrectionSchema.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      const chat = await this.lockChat(tx, chatId);
      this.assertOwner(chat, userId);
      const now = this.clock();
      const storeKey = this.storeKey;
      if (!storeKey) throw new NotFoundException('Подбор не найден.');
      const previous = await tx.consultationEpisode.findFirst({
        where: { id: episodeId, scope: { chatId, subjectKey: userId, storeKey }, expiresAt: { gt: now } },
      });
      if (!previous) throw new NotFoundException('Подбор не найден.');
      if (previous.revision !== revision) throw new ConflictException('Подбор изменился.');
      const applied = applyEpisodeChange(memorySnapshotSchema.parse(previous.snapshot), change, null);
      const changed = applied.contentChanged || Boolean(change.outcome && change.outcome !== previous.outcome);
      if (!changed) return episodeView(previous, now);
      const next = await tx.consultationEpisode.update({
        where: { id: previous.id, revision },
        data: {
          snapshot: applied.snapshot, revision: { increment: 1 }, contentRevision: { increment: 1 },
          ...(change.outcome ? { status: 'CLOSED' as const, outcome: change.outcome, closedAt: now } : {}),
          lastMeaningfulAt: now, expiresAt: new Date(now.getTime() + MEMORY_RETENTION_MS),
        },
      });
      await tx.consultationMemoryScope.update({ where: { id: previous.scopeId }, data: { memoryEpoch: { increment: 1 } } });
      return episodeView(next, now);
    }, memoryTransaction);
  }

  async remove(chatId: string, userId: string, episodeId: string) {
    await this.prisma.$transaction(async (tx) => {
      const chat = await this.lockChat(tx, chatId);
      this.assertOwner(chat, userId);
      const storeKey = this.storeKey;
      if (!storeKey) return;
      const episode = await tx.consultationEpisode.findFirst({
        where: { id: episodeId, scope: { chatId, subjectKey: userId, storeKey } },
      });
      if (!episode) return;
      await tx.consultationEpisode.delete({ where: { id: episode.id } });
      await this.invalidateThrough(tx, episode.scopeId, chat.consultationInputSeq);
    }, memoryTransaction);
  }

  private async invalidateThrough(tx: Prisma.TransactionClient, scopeId: string, inputSeq: number) {
    await tx.consultationMemoryScope.update({
      where: { id: scopeId },
      data: { memoryEpoch: { increment: 1 }, purgedThroughSeq: inputSeq },
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired() {
    const storeKey = this.storeKey;
    if (!storeKey) return 0;
    const now = this.clock();
    const candidates = await this.prisma.consultationEpisode.findMany({
      where: { scope: { storeKey }, expiresAt: { lte: now } },
      select: { id: true, scopeId: true, scope: { select: { chatId: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 1000,
    });
    let count = 0;
    for (const { id, scopeId, scope } of candidates) {
      if (!scope.chatId) continue;
      count += await this.prisma.$transaction(async (tx) => {
        const chat = await this.lockChat(tx, scope.chatId);
        if (!chat) return 0;
        const { count: deleted } = await tx.consultationEpisode.deleteMany({ where: { id, scopeId, expiresAt: { lte: now } } });
        if (deleted) await this.invalidateThrough(tx, scopeId, chat.consultationInputSeq);
        return deleted;
      }, memoryTransaction);
    }
    await this.prisma.consultationTurnReceipt.deleteMany({ where: { scope: { storeKey }, expiresAt: { lte: now } } });
    return count;
  }
}
