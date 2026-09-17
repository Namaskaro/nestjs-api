import { z } from 'zod';

// ======================================================
// HANDOFF: ДОБАВЛЕНО — единая схема решения пользователя
// ======================================================

export const OperatorOfferDecisionSchema = z.enum(['accept', 'decline']);

export const OperatorClarificationInterruptSchema = z.object({
  kind: z.literal('operator_clarification'),
  question: z.string(),
});

export const OperatorCllarificationResumeSchema = z.object({
  kind: z.literal('operator_clarification'),
  operatorClarificationAnswer: z.string(),
});

export const OperatorOfferInterruptSchema = z.object({
  kind: z.literal('operator_offer'),

  question: z.string(),

  options: z.tuple([
    z.object({
      id: z.literal('accept'),
      label: z.string(),
    }),

    z.object({
      id: z.literal('decline'),
      label: z.string(),
    }),
  ]),
});

// ======================================================
// HANDOFF: ИЗМЕНЕНО — возвращён discriminator kind
// ======================================================

export const OperatorOfferResumeSchema = z.object({
  kind: z.literal('operator_offer'),
  decision: OperatorOfferDecisionSchema,
});

export type OperatorOfferDecision = z.infer<typeof OperatorOfferDecisionSchema>;

export type OperatorOfferInterrupt = z.infer<
  typeof OperatorOfferInterruptSchema
>;

export type OperatorOfferResume = z.infer<typeof OperatorOfferResumeSchema>;
