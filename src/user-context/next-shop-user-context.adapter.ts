
import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, Optional,
} from '@nestjs/common';
import { Role } from '@prisma/generated';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { CONSULTATION_MEMORY_CLOCK, consultationMemoryStoreKey } from '@/src/consultation-memory/consultation-memory.service';
import { NextShopMemorySource, nextShopMemoryKey } from '@/src/consultation-memory/next-shop-memory.adapter';
import { PrismaMemoryRepository } from '@/src/consultation-memory/prisma-memory.repository';
import { UserContext, UserContextError, type PreferencePolicy } from './user-context.application';
import type { ConfirmPreference, PreferenceKey } from './user-context.contract';
import { PrismaUserContextRepository } from './prisma-user-context.repository';

type Actor = { id: string; role: string };
type NextShopConfirmation = Omit<ConfirmPreference, 'evidence'> & {
  evidence: Omit<ConfirmPreference['evidence'], 'sourceKind' | 'sourceKey'> & { chatId: string };
};

const profiles = new Set(['SHOES', 'CLOTHES', 'ACCESSORIES']);
export const nextShopPreferencePolicy: PreferencePolicy = (preference, evidence, criterion) => {
  if (!profiles.has(preference.domainKey) || preference.domainKey !== evidence.profileId ||
      preference.preferenceKey !== 'color' || criterion.attributeId !== 'color' || criterion.operator !== 'eq') return undefined;
  const match = evidence.criteria.find(item => item.attributeId === criterion.attributeId && item.operator === criterion.operator);
  return typeof match?.value === 'string' ? match.value : undefined;
};

const logger = new Logger('NextShopUserContext');

async function translate<T>(work: Promise<T>) {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof UserContextError)) {
      logger.error('User context storage operation failed');
      throw new InternalServerErrorException('Не удалось выполнить операцию с контекстом.');
    }
    if (error.code === 'conflict') throw new ConflictException('Контекст или источник уже изменился.');
    if (error.code === 'not_found') throw new NotFoundException('Источник предпочтения недоступен.');
    throw new BadRequestException('Этот критерий нельзя сохранить как предпочтение.');
  }
}

@Injectable()
export class NextShopUserContext {
  private readonly application: UserContext;

  constructor(
    prisma: PrismaService,
    @Optional() @Inject(CONSULTATION_MEMORY_CLOCK) clock: () => Date = () => new Date(),
  ) {
    const memory = new PrismaMemoryRepository(prisma, new NextShopMemorySource());
    this.application = new UserContext(new PrismaUserContextRepository(prisma, memory), clock, nextShopPreferencePolicy);
  }

  get(user: Actor) {
    return translate(this.application.get(this.owner(user)));
  }

  confirm(user: Actor, command: NextShopConfirmation) {
    const key = this.owner(user);
    if (process.env.USER_CONTEXT_ENABLED !== '1') throw new NotFoundException('Подтверждение предпочтений отключено.');
    const { chatId, ...evidence } = command.evidence;
    const { sourceKind, sourceKey } = nextShopMemoryKey(key.storeKey, key.subjectKey, chatId);
    return translate(this.application.confirm(key, { ...command, evidence: { ...evidence, sourceKind, sourceKey } }));
  }

  remove(user: Actor, expectedRevision: number, preference?: PreferenceKey) {
    return translate(this.application.remove(this.owner(user), expectedRevision, preference));
  }

  private owner(user: Actor) {
    const storeKey = consultationMemoryStoreKey();
    if (user?.role !== Role.Client) throw new ForbiddenException('Контекст доступен владельцу аккаунта.');
    if (!storeKey) throw new NotFoundException('Контекст не настроен.');
    return { storeKey, subjectKey: user.id };
  }
}
