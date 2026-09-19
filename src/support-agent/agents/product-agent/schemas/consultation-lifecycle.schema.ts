import { z } from 'zod';

export const ConsultationSessionStatusSchema = z.enum([
  'ACTIVE',
  'COMPLETED',
  'HANDED_OFF',
  'ABANDONED',
]);

export const ConsultationUserCompletionReasonSchema = z.enum([
  'USER_DONE',
  'PRODUCT_SELECTED',
  'USER_STOPPED',
]);

export const ConsultationCompletionReasonSchema = z.enum([
  ...ConsultationUserCompletionReasonSchema.options,
  'HANDOFF',
  'STALE',
]);

export const ConsultationFeedbackSourceSchema = z.enum(['BUTTON', 'TEXT']);

export const ConsultationFeedbackSchema = z.object({
  helpful: z.boolean(),

  source: ConsultationFeedbackSourceSchema,

  submittedAt: z.string().datetime(),
});

export const ConsultationSessionSchema = z
  .object({
    sessionId: z.string().min(1),

    status: ConsultationSessionStatusSchema,

    needIds: z.array(z.string().min(1)).max(5),

    startedAt: z.string().datetime(),

    lastActivityAt: z.string().datetime(),

    completedAt: z.string().datetime().nullable(),

    completionReason: ConsultationCompletionReasonSchema.nullable(),

    selectedProductIds: z.array(z.string().min(1)).max(4),

    feedback: ConsultationFeedbackSchema.nullable(),
  })
  .superRefine((session, ctx) => {
    if (
      session.status === 'ACTIVE' &&
      (session.completedAt !== null ||
        session.completionReason !== null ||
        session.feedback !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'ACTIVE consultation session содержит terminal state.',
      });
    }

    if (session.status === 'COMPLETED') {
      if (
        session.completedAt === null ||
        !session.completionReason ||
        !ConsultationUserCompletionReasonSchema.safeParse(
          session.completionReason,
        ).success
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'COMPLETED consultation session не имеет valid completion.',
        });
      }
    }

    if (
      session.status === 'COMPLETED' &&
      session.completionReason === 'PRODUCT_SELECTED' &&
      session.selectedProductIds.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'PRODUCT_SELECTED требует выбранный товар.',
      });
    }

    if (
      session.status === 'HANDED_OFF' &&
      (session.completedAt === null || session.completionReason !== 'HANDOFF')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'HANDED_OFF consultation session имеет неверный reason.',
      });
    }

    if (
      session.status === 'ABANDONED' &&
      (session.completedAt === null || session.completionReason !== 'STALE')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'ABANDONED consultation session имеет неверный reason.',
      });
    }

    if (session.feedback !== null && session.status !== 'COMPLETED') {
      ctx.addIssue({
        code: 'custom',
        message: 'Feedback допустим только для COMPLETED consultation.',
      });
    }
  });

export const ConsultationCompletionFeedbackRequestSchema = z.object({
  kind: z.literal('HELPFULNESS'),

  options: z.tuple([z.literal('HELPFUL'), z.literal('NOT_HELPFUL')]),
});

export const ConsultationCompletionFeedbackValueSchema = z.object({
  helpful: z.boolean(),

  submittedAt: z.string().datetime(),
});

export const ConsultationCompletionPresentationSchema = z.object({
  sessionId: z.string().min(1),

  status: z.literal('COMPLETED'),

  reason: ConsultationUserCompletionReasonSchema,

  selectedProductIds: z.array(z.string().min(1)).max(4),

  feedbackRequest: ConsultationCompletionFeedbackRequestSchema,

  feedback: ConsultationCompletionFeedbackValueSchema.nullable().default(null),
});

export const ConsultationFeedbackReceiptSchema = z.object({
  sessionId: z.string().min(1),

  helpful: z.boolean(),

  submittedAt: z.string().datetime(),
});

export type ConsultationSessionStatus = z.infer<
  typeof ConsultationSessionStatusSchema
>;

export type ConsultationUserCompletionReason = z.infer<
  typeof ConsultationUserCompletionReasonSchema
>;

export type ConsultationCompletionReason = z.infer<
  typeof ConsultationCompletionReasonSchema
>;

export type ConsultationFeedbackSource = z.infer<
  typeof ConsultationFeedbackSourceSchema
>;

export type ConsultationFeedback = z.infer<typeof ConsultationFeedbackSchema>;

export type ConsultationSession = z.infer<typeof ConsultationSessionSchema>;

export type ConsultationCompletionPresentation = z.infer<
  typeof ConsultationCompletionPresentationSchema
>;

export type ConsultationFeedbackReceipt = z.infer<
  typeof ConsultationFeedbackReceiptSchema
>;
