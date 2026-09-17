import { z } from 'zod';
import {
  ConsultationAlternativeStrategySchema,
  ConsultationNextActionSchema,
  ConsultationRefinementFieldSchema,
} from './consultation-agent.schema';

export const ConsultationCompletionOutputSchema = z.object({
  message: z.string().trim().min(1).max(6000),
  decisions: z
    .array(
      z.object({
        needId: z.string().min(1),
        memoryRevision: z.number().int().nonnegative(),
        nextAction: ConsultationNextActionSchema,
        suggestedField: ConsultationRefinementFieldSchema.nullable(),
        alternativeStrategy: ConsultationAlternativeStrategySchema.nullable(),
        alternativeDescription: z.string().trim().min(1).nullable(),
        question: z.string().trim().min(1).nullable(),
      }),
    )
    .min(1)
    .max(5),
  recommendations: z
    .array(
      z.object({
        needId: z.string().min(1),
        productId: z.string().min(1),
        role: z.enum(['primary', 'alternative']),
      }),
    )
    .max(15),
  evidence: z
    .array(
      z.object({
        needId: z.string().min(1),
        productId: z.string().min(1),
        kind: z.enum(['reason', 'tradeoff']),
        attributeId: z.string().min(1),
        referenceToken: z
          .string()
          .min(1)
          .describe('Копия token из текущих referenceOptions этого need.'),
        text: z.string().trim().min(1).max(500),
      }),
    )
    .max(180),
  unknowns: z
    .array(
      z.object({
        needId: z.string().min(1),
        productId: z.string().min(1),
        attributeId: z.string().min(1),
      }),
    )
    .max(480),
});

export type ConsultationCompletionOutput = z.infer<
  typeof ConsultationCompletionOutputSchema
>;
