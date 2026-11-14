
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/generated';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { ConsultationMemory, MemoryError } from './consultation-memory.application';
import { PrismaUserContextRepository } from '@/src/user-context/prisma-user-context.repository';
import { revokeEpisodePreferences } from '@/src/user-context/user-context.application';
import { NextShopMemorySource, nextShopCorrectionSchema, nextShopCriteriaAreValid, nextShopMemoryCandidate, nextShopMemoryKey } from './next-shop-memory.adapter';
import { PrismaMemoryRepository } from './prisma-memory.repository';
import type { MemoryBasis, ResumeDecision } from './memory.port';
import type {
  ConsultationMemoryAdmission, ConsultationMemoryBasis, ConsultationMemoryCandidate,
} from './consultation-memory.types';

export const CONSULTATION_MEMORY_CLOCK = Symbol('CONSULTATION_MEMORY_CLOCK');

export function consultationMemoryStoreKey() {
  const key = process.env.CONSULTATION_MEMORY_STORE_KEY?.trim();
  return key && /^[a-zA-Z0-9_-]{1,80}$/.test(key) ? key : null;
}

const writeVersion = () => process.env.CONSULTATION_MEMORY_WRITE_V2 === '1' ? 2 : 1;

async function mapError<T>(run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (error) {
    if (!(error instanceof MemoryError)) throw error;
    if (error.code === 'not_found') throw new NotFoundException('Подбор или предложение недоступны.');
    throw new ConflictException('Подбор или предложение больше не актуальны.');
  }
}

@Injectable()
export class ConsultationMemoryService {
  private readonly repository: PrismaMemoryRepository;
  private readonly application: ConsultationMemory;

  constructor(
    prisma: PrismaService,
    @Optional() @Inject(CONSULTATION_MEMORY_CLOCK) clock: () => Date = () => new Date(),
  ) {
    const source = new NextShopMemorySource();
    const context = new PrismaUserContextRepository(prisma, new PrismaMemoryRepository(prisma, source));
    this.repository = new PrismaMemoryRepository(prisma, source, (tx, key, episodeId, changed) =>
      revokeEpisodePreferences(context.bind(tx), key, {
        sourceKind: key.sourceKind, sourceKey: key.sourceKey, episodeId,
      }, changed));
    this.application = new ConsultationMemory(this.repository, clock,
      candidate => createHash('sha256').update(JSON.stringify(candidate)).digest('hex'), writeVersion);
  }

  get enabled() {
    return process.env.CONSULTATION_MEMORY_ENABLED === '1' && Boolean(consultationMemoryStoreKey());
  }

  async getResumeOffer(chatId: string, userId: string) {
    if (!this.enabled) return null;
    return this.application.getResumeOffer(this.key(chatId, userId));
  }

  async getResumeState(chatId: string, userId: string) {
    if (!this.enabled) return { consultationOffer: null, consultationIntent: null };
    return this.application.getResumeState(this.key(chatId, userId));
  }

  async decideResumeOffer(chatId: string, userId: string, offerId: string, decision: ResumeDecision) {
    if (!this.enabled) throw new NotFoundException('Предложение недоступно.');
    return mapError(this.application.decideResumeOffer(this.key(chatId, userId), offerId, decision));
  }

  async consumeResumeOffer(tx: Prisma.TransactionClient, chat: { id: string }, userId: string, offerId: string) {
    if (!this.enabled) throw new NotFoundException('Предложение недоступно.');
    return mapError(this.application.consumeResumeOffer(this.repository.bind(tx), this.key(chat.id, userId), offerId));
  }

  async getBasis(source: ConsultationMemoryAdmission): Promise<ConsultationMemoryBasis | null> {
    if (!this.enabled) return null;
    const basis = await this.application.getBasis({ ...source, key: this.key(source.chatId, source.userId) });
    if (!basis) return null;
    const { key, memoryEpoch, revisions, witnesses, continuation } = basis;
    return { ...source, storeKey: key.storeKey, memoryEpoch, revisions, witnesses, ...(continuation ? { continuation } : {}) };
  }

  async verifyReplyCurrent(basis: ConsultationMemoryBasis) {
    if (!this.isCurrentStore(basis)) throw new ConflictException('Результат AI устарел после изменения памяти.');
    return mapError(this.application.verifyReplyCurrent(this.toEngineBasis(basis)));
  }

  async assertReplyCurrent(tx: Prisma.TransactionClient, basis: ConsultationMemoryBasis) {
    if (!this.isCurrentStore(basis)) throw new ConflictException('Результат AI устарел после изменения памяти.');
    return mapError(this.application.assertReplyCurrent(this.repository.bind(tx), this.toEngineBasis(basis)));
  }

  async project(basis: ConsultationMemoryBasis, assistantMessageId: string, candidate: ConsultationMemoryCandidate) {
    if (!this.isCurrentStore(basis)) return 'STALE' as const;
    const version = writeVersion();
    const normalized = nextShopMemoryCandidate(candidate, version);
    if (normalized.changes.some(({ criteria }) => !nextShopCriteriaAreValid(criteria, version))) {
      throw new BadRequestException('Некорректные критерии подбора.');
    }
    return this.application.project(this.toEngineBasis(basis), assistantMessageId, normalized);
  }

  async list(chatId: string, userId: string) {
    return mapError(this.application.list(this.key(chatId, userId)));
  }

  async correct(chatId: string, userId: string, episodeId: string, revision: number, raw: unknown) {
    const correction = nextShopCorrectionSchema.safeParse(raw);
    if (!correction.success) throw new BadRequestException('Некорректное исправление подбора.');
    return mapError(this.application.correct(this.key(chatId, userId), episodeId, revision, correction.data));
  }

  async remove(chatId: string, userId: string, episodeId: string) {
    return mapError(this.application.remove(this.key(chatId, userId), episodeId));
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired() {
    const storeKey = consultationMemoryStoreKey();
    return storeKey ? this.application.purgeExpired(storeKey) : 0;
  }

  private key(chatId: string, userId: string) {
    return nextShopMemoryKey(consultationMemoryStoreKey() ?? '', userId, chatId);
  }

  private isCurrentStore(basis: ConsultationMemoryBasis) {
    return this.enabled && consultationMemoryStoreKey() === basis.storeKey;
  }

  private toEngineBasis({ chatId, userId, storeKey, ...basis }: ConsultationMemoryBasis): MemoryBasis {
    return { ...basis, key: nextShopMemoryKey(storeKey, userId, chatId) };
  }
}
