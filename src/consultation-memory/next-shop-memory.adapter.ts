
import { ChatMode, ConversationMessageRole, Role, type Prisma } from '@prisma/generated';
import type { MemoryAdmission, MemoryScopeKey, MemorySourceState } from './memory.port';
import type { PrismaMemorySource } from './prisma-memory.repository';
import { getConsultationContinuationOfferId, type ConsultationMemoryCandidate } from './consultation-memory.types';
import { memoryCorrectionSchema } from './consultation-memory.core';

const sourceKind = 'CHAT';
const supported = new Set(['category', 'subcategory', 'brand', 'color', 'price', 'sizes']);

export function nextShopMemoryKey(storeKey: string, userId: string, chatId: string): MemoryScopeKey {
  return { storeKey, subjectKey: userId, sourceKind, sourceKey: chatId };
}

export function nextShopCriteriaAreValid(criteria: ReturnType<typeof memoryCorrectionSchema.parse>['criteria'], version: 1 | 2) {
  if (!criteria) return true;
  return (criteria.goalKey === undefined || (version === 2 && criteria.goalKey === criteria.profileId)) &&
    (criteria.clear ?? []).every(({ attributeId }) => supported.has(attributeId)) &&
    (criteria.set ?? []).every(({ attributeId, operator, value }) => supported.has(attributeId) &&
      (attributeId !== 'price' || (typeof value === 'number' && value >= 0 && value <= 1_000_000_000 && operator !== 'contains')));
}

export function nextShopMemoryCandidate(candidate: ConsultationMemoryCandidate, version: 1 | 2): ConsultationMemoryCandidate {
  return {
    ...candidate,
    changes: candidate.changes.map(change => {
      if (!change.criteria) return change;
      const { set, clear, profileId } = change.criteria;
      return {
        ...change,
        criteria: {
          ...(profileId !== undefined ? { profileId, ...(version === 2 ? { goalKey: profileId } : {}) } : {}),
          ...(set ? { set: set.filter(({ attributeId }) => supported.has(attributeId)) } : {}),
          ...(clear ? { clear: clear.filter(({ attributeId }) => supported.has(attributeId)) } : {}),
        },
      };
    }),
  };
}

export const nextShopCorrectionSchema = memoryCorrectionSchema.refine(({ criteria }) => nextShopCriteriaAreValid(
  criteria, process.env.CONSULTATION_MEMORY_WRITE_V2 === '1' ? 2 : 1,
));

export class NextShopMemorySource implements PrismaMemorySource {
  async state(tx: Prisma.TransactionClient, key: MemoryScopeKey, lock: boolean) {
    if (key.sourceKind !== sourceKind) return null;
    if (lock) await tx.$queryRaw`SELECT id FROM "Chat" WHERE id = ${key.sourceKey} FOR UPDATE`;
    const chat = await tx.chat.findUnique({
      where: { id: key.sourceKey },
      select: {
        userId: true, mode: true, operatorId: true, handoffVersion: true, consultationInputSeq: true,
        consultationNextInputSeq: true, consultationNextHandoffVersion: true,
        consultationAttemptId: true, consultationSourceMessageId: true, user: { select: { role: true } },
      },
    });
    return chat ? {
      subjectKey: chat.userId, authorizedCustomer: chat.user.role === Role.Client,
      assistantAvailable: chat.mode === ChatMode.BOT && chat.operatorId === null,
      handoffVersion: chat.handoffVersion, inputSeq: chat.consultationInputSeq,
      ...(chat.consultationNextInputSeq === chat.consultationInputSeq &&
          chat.consultationNextHandoffVersion === chat.handoffVersion ? { nextIntent: 'start_new' as const } : {}),
      attemptId: chat.consultationAttemptId, sourceMessageId: chat.consultationSourceMessageId,
    } : null;
  }

  async input(tx: Prisma.TransactionClient, admission: MemoryAdmission) {
    if (admission.key.sourceKind !== sourceKind) return null;
    const input = await tx.message.findFirst({
      where: {
        id: admission.sourceMessageId, chatId: admission.key.sourceKey, authorId: admission.key.subjectKey,
        role: ConversationMessageRole.USER, consultationInputSeq: admission.inputSeq,
      },
      select: { payload: true },
    });
    return input ? { offerId: getConsultationContinuationOfferId(input.payload) } : null;
  }

  async hasReply(tx: Prisma.TransactionClient, key: MemoryScopeKey, inputId: string, replyId?: string) {
    if (key.sourceKind !== sourceKind) return false;
    return Boolean(await tx.message.findFirst({
      where: {
        chatId: key.sourceKey, assistantSourceMessageId: inputId,
        ...(replyId ? { id: replyId, role: ConversationMessageRole.ASSISTANT, expectsEpisodeProjection: true } : {}),
      },
      select: { id: true },
    }));
  }

  async markStartNew(tx: Prisma.TransactionClient, key: MemoryScopeKey, source: MemorySourceState) {
    await tx.chat.update({
      where: { id: key.sourceKey, userId: key.subjectKey },
      data: { consultationNextInputSeq: source.inputSeq, consultationNextHandoffVersion: source.handoffVersion },
    });
  }

  chatLink(key: MemoryScopeKey) {
    return key.sourceKind === sourceKind ? key.sourceKey : null;
  }
}
