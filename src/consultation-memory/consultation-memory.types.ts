import type { ConsultationMemoryWitness, MemoryConstraint } from './memory.contract';
export * from './memory.contract';

export interface ConsultationMemoryAdmission {
  chatId: string;
  userId: string;
  sourceMessageId: string;
  inputSeq: number;
  attemptId: string;
  handoffVersion: number;
}

export interface ConsultationMemoryContinuation {
  episodeId: string;
  taskKey: string;
  revision: number;
  snapshot: {
    profileId: string | null;
    goalKey?: string | null;
    constraints: MemoryConstraint[];
    lastSourceMessageId: string | null;
  };
}

export interface ConsultationMemoryBasis extends ConsultationMemoryAdmission {
  storeKey: string;
  memoryEpoch: number;
  revisions: Record<string, number>;
  witnesses: Record<string, ConsultationMemoryWitness>;
  continuation?: ConsultationMemoryContinuation;
}

export const consultationContinuationOfferIdField = 'consultationContinuationOfferId';
export const consultationActionField = 'consultationAction';
export type ConsultationInputAction = 'resume_unchanged' | 'start_new';

export function getConsultationAction(payload: unknown): ConsultationInputAction | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const action = (payload as Record<string, unknown>)[consultationActionField];
  return action === 'resume_unchanged' || action === 'start_new' ? action : undefined;
}

export function getConsultationContinuationOfferId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>)[consultationContinuationOfferIdField];
  return typeof value === 'string' ? value : undefined;
}
