import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import {
  ChatMode, ConversationMessageRole, Prisma, Role, type ConsultationEpisode, type ConsultationMemoryScope,
} from '@prisma/generated';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import {
  applyEpisodeChange, memoryCandidateSchema, memoryCorrectionSchema, memorySnapshotSchema,
  MEMORY_DAY_MS, MEMORY_RETENTION_MS,
} from './consultation-memory.core';
import { getConsultationContinuationOfferId } from './consultation-memory.types';
import type {
  ConsultationMemoryAdmission, ConsultationMemoryBasis, ConsultationMemoryCandidate,
  ConsultationMemoryContinuation,
} from './consultation-memory.types';

export const CONSULTATION_MEMORY_CLOCK = Symbol('CONSULTATION_MEMORY_CLOCK');
const memoryTransaction = { maxWait: 1000, timeout: 3000 };
const offerInactivityMs = 7 * MEMORY_DAY_MS;
const offerLifetimeMs = MEMORY_DAY_MS;
const offerInclude = { scope: true, episode: true } as const;
type ResumeOffer = Prisma.ConsultationResumeOfferGetPayload<{ include: typeof offerInclude }>;
type OfferChat = Pick<MemoryChat, 'id' | 'userId' | 'mode' | 'operatorId' | 'handoffVersion' | 'consultationInputSeq'>;
type ResumeDecision = 'continue' | 'later';
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

function ownsScope(scope: ConsultationMemoryScope, chatId: string, userId: string, storeKey: string) {
  return scope.storeKey === storeKey && scope.subjectKey === userId &&
    scope.chatId === chatId && scope.sourceKey === chatId && scope.sourceKind === 'CHAT';
}

function offerCurrent(offer: ResumeOffer, chat: OfferChat, storeKey: string, now: Date, inputSeq = chat.consultationInputSeq) {
  return chat.mode === ChatMode.BOT && chat.operatorId === null &&
    ownsScope(offer.scope, chat.id, chat.userId, storeKey) &&
    offer.scopeId === offer.episode.scopeId && offer.memoryEpoch === offer.scope.memoryEpoch &&
    offer.inputSeq === inputSeq && offer.handoffVersion === chat.handoffVersion &&
    offer.episodeRevision === offer.episode.revision &&
    offer.contentRevision === offer.episode.contentRevision &&
    offer.episode.status === 'OPEN' && offer.expiresAt > now && offer.episode.expiresAt > now;
}

function offerCriteria(episode: ConsultationEpisode) {
  const { profileId, constraints } = memorySnapshotSchema.parse(episode.snapshot);
  return { profileId, constraints };
}

function continuationView(episode: ConsultationEpisode): ConsultationMemoryContinuation {
  const { profileId, constraints, lastSourceMessageId } = memorySnapshotSchema.parse(episode.snapshot);
  return { episodeId: episode.id, taskKey: episode.taskKey, revision: episode.revision,
    snapshot: { profileId,
      constraints: constraints.map(({ attributeId, operator, value, unit }) => ({ attributeId, operator, value, unit })),
      lastSourceMessageId } };
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

  async getResumeOffer(chatId: string, userId: string) {
    const storeKey = this.storeKey;
    if (!this.enabled || !storeKey) return null;
    return this.prisma.$transaction(async (tx) => {
      const chat = await this.lockChat(tx, chatId);
      if (!chat || chat.userId !== userId || chat.user.role !== Role.Client ||
          chat.mode !== ChatMode.BOT || chat.operatorId !== null) return null;
      const now = this.clock();
      const scope = await tx.consultationMemoryScope.findUnique({ where: this.scopeWhere(chatId, storeKey) });
      if (!scope || !ownsScope(scope, chatId, userId, storeKey) ||
          (scope.offerSuppressedUntil && scope.offerSuppressedUntil > now)) return null;

      if (chat.consultationSourceMessageId && !await tx.message.findUnique({
        where: { chatId_assistantSourceMessageId: { chatId, assistantSourceMessageId: chat.consultationSourceMessageId } },
        select: { id: true },
      })) return null;

      const inactivityCutoff = new Date(now.getTime() - offerInactivityMs);
      const episode = await tx.consultationEpisode.findFirst({
        where: { scopeId: scope.id, status: 'OPEN', lastMeaningfulAt: { lte: inactivityCutoff }, expiresAt: { gt: now } },
        orderBy: [{ lastMeaningfulAt: 'desc' }, { id: 'asc' }],
      });
      if (!episode) return null;

      let offer = await tx.consultationResumeOffer.findUnique({
        where: { episodeId_contentRevision: { episodeId: episode.id, contentRevision: episode.contentRevision } },
        include: offerInclude,
      });
      if (!offer) {
        offer = await tx.consultationResumeOffer.create({
          data: {
            scopeId: scope.id, episodeId: episode.id, episodeRevision: episode.revision,
            contentRevision: episode.contentRevision, memoryEpoch: scope.memoryEpoch,
            inputSeq: chat.consultationInputSeq, handoffVersion: chat.handoffVersion,
            expiresAt: new Date(Math.min(now.getTime() + offerLifetimeMs, episode.expiresAt.getTime())),
          },
          include: offerInclude,
        });
      }
      if (!offerCurrent(offer, chat, storeKey, now) || offer.consumedAt || offer.decision === 'later') return null;
      return {
        offerId: offer.id, expiresAt: offer.expiresAt,
        state: offer.decision === 'continue' ? 'continued' as const : 'pending' as const,
        criteria: offerCriteria(episode),
      };
    }, memoryTransaction);
  }

  async decideResumeOffer(chatId: string, userId: string, offerId: string, decision: ResumeDecision) {
    const storeKey = this.storeKey;
    if (!this.enabled || !storeKey) throw new NotFoundException('Предложение недоступно.');
    return this.prisma.$transaction(async (tx) => {
      const chat = await this.lockChat(tx, chatId);
      this.assertOwner(chat, userId);
      const offer = await tx.consultationResumeOffer.findUnique({ where: { id: offerId }, include: offerInclude });
      const now = this.clock();
      if (!offer || !ownsScope(offer.scope, chatId, userId, storeKey)) {
        throw new NotFoundException('Предложение недоступно.');
      }
      if (!offerCurrent(offer, chat, storeKey, now) || offer.consumedAt ||
          (offer.decision && offer.decision !== decision)) {
        throw new ConflictException('Предложение больше не актуально.');
      }
      if (!offer.decision) {
        await tx.consultationResumeOffer.update({
          where: { id: offer.id }, data: { decision, decidedAt: now },
        });
        if (decision === 'later') {
          await tx.consultationMemoryScope.update({
            where: { id: offer.scopeId }, data: { offerSuppressedUntil: new Date(now.getTime() + offerInactivityMs) },
          });
        }
      }
      return decision === 'later' ? { decision } : {
        decision, continuationOfferId: offer.id, criteria: offerCriteria(offer.episode),
      };
    }, memoryTransaction);
  }

  async consumeResumeOffer(tx: Prisma.TransactionClient, chat: OfferChat, userId: string, offerId: string) {
    const storeKey = this.storeKey;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!this.enabled || !storeKey || chat.userId !== userId || user?.role !== Role.Client) {
      throw new NotFoundException('Предложение недоступно.');
    }
    const offer = await tx.consultationResumeOffer.findUnique({ where: { id: offerId }, include: offerInclude });
    const now = this.clock();
    if (!offer || !ownsScope(offer.scope, chat.id, userId, storeKey)) {
      throw new NotFoundException('Предложение недоступно.');
    }
    if (!offerCurrent(offer, chat, storeKey, now) || offer.decision !== 'continue' || offer.consumedAt) {
      throw new ConflictException('Предложение больше не актуально.');
    }
    const continuation = continuationView(offer.episode);
    await tx.consultationResumeOffer.update({ where: { id: offer.id }, data: { consumedAt: now } });
    return continuation;
  }

  private async consumedOffer(
    tx: Pick<Prisma.TransactionClient, 'consultationResumeOffer'>,
    scopeId: string,
    source: ConsultationMemoryAdmission,
    offerId: string | undefined,
  ) {
    if (!offerId) return null;
    return tx.consultationResumeOffer.findFirst({
      where: { id: offerId, scopeId, inputSeq: source.inputSeq - 1, decision: 'continue', consumedAt: { not: null } },
      include: offerInclude,
    });
  }

  async getBasis(source: ConsultationMemoryAdmission): Promise<ConsultationMemoryBasis | null> {
    const storeKey = this.storeKey;
    if (!storeKey || !this.enabled) return null;
    const chat = await this.prisma.chat.findUnique({ where: { id: source.chatId }, select: memoryChatSelect });
    if (!chat || !currentAdmission(chat, source)) return null;
    const now = this.clock();
    const scope = await this.prisma.consultationMemoryScope.findUnique({
      where: this.scopeWhere(source.chatId, storeKey),
      include: { episodes: {
        where: { status: 'OPEN', expiresAt: { gt: now } },
        select: { id: true, taskKey: true, revision: true, snapshot: true },
      } },
    });
    if (scope && (!ownsScope(scope, source.chatId, source.userId, storeKey) || source.inputSeq <= scope.purgedThroughSeq)) return null;
    const message = await this.prisma.message.findFirst({
      where: { id: source.sourceMessageId, chatId: source.chatId, authorId: source.userId,
        role: ConversationMessageRole.USER, consultationInputSeq: source.inputSeq },
      select: { payload: true },
    });
    if (!message) return null;
    const offer = scope ? await this.consumedOffer(this.prisma, scope.id, source,
      getConsultationContinuationOfferId(message.payload)) : null;
    const continuation = offer && offerCurrent(offer, chat, storeKey, now, source.inputSeq - 1)
      ? continuationView(offer.episode) : undefined;
    return {
      ...source,
      storeKey,
      memoryEpoch: scope?.memoryEpoch ?? 0,
      revisions: Object.fromEntries((scope?.episodes ?? []).map(({ taskKey, revision }) => [taskKey, revision])),
      witnesses: Object.fromEntries((scope?.episodes ?? []).map(({ id, revision, snapshot }) => [
        id, { revision, sourceMessageId: memorySnapshotSchema.parse(snapshot).lastSourceMessageId },
      ])),
      ...(continuation ? { continuation } : {}),
    };
  }

  async verifyReplyCurrent(basis: ConsultationMemoryBasis) {
    await this.prisma.$transaction((tx) => this.assertReplyCurrent(tx, basis), memoryTransaction);
  }

  async assertReplyCurrent(tx: Prisma.TransactionClient, basis: ConsultationMemoryBasis) {
    const stale = () => new ConflictException('Результат AI устарел после изменения памяти.');
    if (!this.enabled || this.storeKey !== basis.storeKey) throw stale();
    const chat = await this.lockChat(tx, basis.chatId);
    if (!chat || !currentAdmission(chat, basis)) throw stale();
    const scope = await tx.consultationMemoryScope.findUnique({ where: this.scopeWhere(basis.chatId, basis.storeKey) });
    if (!scope || !ownsScope(scope, basis.chatId, basis.userId, basis.storeKey) ||
        scope.memoryEpoch !== basis.memoryEpoch || basis.inputSeq <= scope.purgedThroughSeq) throw stale();
    const source = await tx.message.findFirst({
      where: { id: basis.sourceMessageId, chatId: basis.chatId, authorId: basis.userId,
        role: ConversationMessageRole.USER, consultationInputSeq: basis.inputSeq },
      select: { id: true, payload: true },
    });
    if (!source) throw stale();
    const now = this.clock();
    const ids = Object.keys(basis.witnesses);
    const rows = await tx.consultationEpisode.findMany({
      where: { scopeId: scope.id, id: { in: ids }, status: 'OPEN', expiresAt: { gt: now } },
      select: { id: true, revision: true, snapshot: true },
    });
    if (rows.length !== ids.length || rows.some(({ id, revision, snapshot }) => {
      const expected = basis.witnesses[id];
      return revision !== expected.revision ||
        memorySnapshotSchema.parse(snapshot).lastSourceMessageId !== expected.sourceMessageId;
    })) throw stale();

    if (basis.continuation) {
      const offer = await this.consumedOffer(tx, scope.id, basis, getConsultationContinuationOfferId(source.payload));
      if (!offer || offer.episode.id !== basis.continuation.episodeId ||
          !offerCurrent(offer, chat, basis.storeKey, now, basis.inputSeq - 1)) throw stale();
    }
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
        select: { id: true, authorId: true, role: true, consultationInputSeq: true, payload: true,
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
      const resumed = basis.continuation && currentScope && chat
        ? await this.consumedOffer(tx, currentScope.id, basis, getConsultationContinuationOfferId(source.payload))
        : null;
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
        const explicitlyResumed = previous && resumed && chat &&
          basis.continuation?.episodeId === previous.id && basis.continuation.revision === previous.revision &&
          resumed.episode.id === previous.id && offerCurrent(resumed, chat, basis.storeKey, now, basis.inputSeq - 1) &&
          snapshot.lastSourceMessageId === basis.continuation.snapshot.lastSourceMessageId;
        if (previous && !explicitlyResumed &&
            (!change.previousSourceMessageId || snapshot.lastSourceMessageId !== change.previousSourceMessageId)) {
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
