import { randomUUID } from 'node:crypto';

import type { ProductContext } from '../context/product-context.schema';
import {
  ConsultationCompletionPresentation,
  ConsultationCompletionPresentationSchema,
  ConsultationFeedbackReceipt,
  ConsultationFeedbackReceiptSchema,
  ConsultationFeedbackSource,
  ConsultationSession,
  ConsultationSessionSchema,
  ConsultationUserCompletionReason,
} from './consultation-lifecycle.schema';

// import {
//   ConsultationCompletionPresentationSchema,
//   ConsultationFeedbackReceiptSchema,
//   ConsultationSessionSchema,
//   type ConsultationCompletionPresentation,
//   type ConsultationFeedbackReceipt,
//   type ConsultationFeedbackSource,
//   type ConsultationSession,
//   type ConsultationUserCompletionReason,
// } from '../../../support-agent/agents/product-agent/schemas/consultation-lifecycle.schema';

function isoNow(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function touchConsultationSession(
  context: ProductContext,
  needIds: readonly string[],
  now?: Date,
): ConsultationSession {
  const timestamp = isoNow(now);

  const current = context.consultationSession;

  const knownNeedIds = new Set(context.needs.map((need) => need.needId));

  const normalizeNeedIds = (values: readonly string[]) =>
    unique(values).filter((needId) => knownNeedIds.has(needId));

  if (!current || current.status !== 'ACTIVE') {
    const session = ConsultationSessionSchema.parse({
      sessionId: randomUUID(),

      status: 'ACTIVE',

      needIds: normalizeNeedIds(needIds),

      startedAt: timestamp,

      lastActivityAt: timestamp,

      completedAt: null,

      completionReason: null,

      selectedProductIds: [],

      feedback: null,
    });

    context.consultationSession = session;

    return session;
  }

  const session = ConsultationSessionSchema.parse({
    ...current,

    needIds: normalizeNeedIds([...current.needIds, ...needIds]),

    lastActivityAt: timestamp,
  });

  context.consultationSession = session;

  return session;
}
export function completeConsultationSession(
  context: ProductContext,
  {
    reason,
    selectedProductIds = [],
    now,
  }: {
    reason: ConsultationUserCompletionReason;

    selectedProductIds?: readonly string[];

    now?: Date;
  },
): ConsultationSession {
  const current = context.consultationSession;

  if (!current || current.status !== 'ACTIVE') {
    throw new Error('ProductAgent: нет активной консультации для завершения.');
  }

  const timestamp = isoNow(now);

  const session = ConsultationSessionSchema.parse({
    ...current,

    status: 'COMPLETED',

    lastActivityAt: timestamp,

    completedAt: timestamp,

    completionReason: reason,

    selectedProductIds: unique(selectedProductIds),

    feedback: null,
  });

  context.consultationSession = session;

  return session;
}

export function markConsultationSessionHandedOff(
  context: ProductContext,
  now?: Date,
): ConsultationSession | null {
  const current = context.consultationSession;

  if (!current || current.status !== 'ACTIVE') {
    return current ?? null;
  }

  const timestamp = isoNow(now);

  const session = ConsultationSessionSchema.parse({
    ...current,

    status: 'HANDED_OFF',

    lastActivityAt: timestamp,

    completedAt: timestamp,

    completionReason: 'HANDOFF',

    feedback: null,
  });

  context.consultationSession = session;

  return session;
}

export function abandonConsultationSession(
  context: ProductContext,
  now?: Date,
): ConsultationSession | null {
  const current = context.consultationSession;

  if (!current || current.status !== 'ACTIVE') {
    return current ?? null;
  }

  const timestamp = isoNow(now);

  const session = ConsultationSessionSchema.parse({
    ...current,

    status: 'ABANDONED',

    lastActivityAt: timestamp,

    completedAt: timestamp,

    completionReason: 'STALE',

    feedback: null,
  });

  context.consultationSession = session;

  return session;
}

export function submitConsultationFeedback(
  context: ProductContext,
  {
    sessionId,
    helpful,
    source,
    now,
  }: {
    sessionId: string;

    helpful: boolean;

    source: ConsultationFeedbackSource;

    now?: Date;
  },
): ConsultationFeedbackReceipt {
  const current = context.consultationSession;

  if (!current || current.sessionId !== sessionId) {
    throw new Error(
      'ProductAgent: consultation session для feedback не найдена.',
    );
  }

  if (current.status !== 'COMPLETED') {
    throw new Error(
      'ProductAgent: feedback допустим только после завершённой консультации.',
    );
  }

  if (
    current.feedback &&
    current.feedback.helpful === helpful &&
    current.feedback.source === source
  ) {
    return ConsultationFeedbackReceiptSchema.parse({
      sessionId: current.sessionId,

      helpful: current.feedback.helpful,

      submittedAt: current.feedback.submittedAt,
    });
  }

  const submittedAt = isoNow(now);

  const session = ConsultationSessionSchema.parse({
    ...current,

    feedback: {
      helpful,

      source,

      submittedAt,
    },
  });

  context.consultationSession = session;

  return ConsultationFeedbackReceiptSchema.parse({
    sessionId: session.sessionId,

    helpful,

    submittedAt,
  });
}

export function buildConsultationCompletionPresentation(
  session: ConsultationSession,
): ConsultationCompletionPresentation {
  if (
    session.status !== 'COMPLETED' ||
    !session.completionReason ||
    session.completionReason === 'HANDOFF' ||
    session.completionReason === 'STALE'
  ) {
    throw new Error(
      'ProductAgent: consultation session не является user completion.',
    );
  }

  return ConsultationCompletionPresentationSchema.parse({
    sessionId: session.sessionId,

    status: 'COMPLETED',

    reason: session.completionReason,

    selectedProductIds: session.selectedProductIds,

    feedbackRequest: {
      kind: 'HELPFULNESS',

      options: ['HELPFUL', 'NOT_HELPFUL'],
    },

    feedback: session.feedback
      ? {
          helpful: session.feedback.helpful,

          submittedAt: session.feedback.submittedAt,
        }
      : null,
  });
}
