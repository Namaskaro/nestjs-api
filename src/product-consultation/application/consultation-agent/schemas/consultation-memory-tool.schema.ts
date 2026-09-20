import { z } from 'zod';

const ScalarValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const ConsultationMemoryOperationSchema = z.object({
  kind: z.enum([
    'goal_add',
    'goal_update',
    'goal_remove',
    'criterion_add',
    'criterion_update',
    'criterion_remove',
    'feedback_upsert',
    'feedback_remove',
  ]),
  id: z.string().trim().min(1).nullable(),
  text: z.string().trim().min(1).max(500).nullable(),
  importance: z.enum(['normal', 'high']).nullable(),
  attributeId: z.string().trim().min(1).nullable(),
  operator: z.enum(['observe', 'eq', 'contains', 'lte', 'gte']).nullable(),
  value: ScalarValueSchema.nullable(),
  unit: z.string().trim().min(1).nullable(),
  required: z.boolean().nullable(),
  productId: z.string().trim().min(1).nullable(),
  reaction: z.enum(['like', 'dislike', 'mixed']).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
  sourceText: z.string().trim().min(1).max(500),
});

export const UpdateConsultationMemoryToolInputSchema = z.object({
  needId: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(ConsultationMemoryOperationSchema).min(1).max(64),
});

export type ConsultationMemoryOperation = z.infer<
  typeof ConsultationMemoryOperationSchema
>;
