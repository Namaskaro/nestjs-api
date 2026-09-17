import { z } from 'zod';

export const StoreKnowledgeQdrantPayloadSchema = z.object({
  knowledgeId: z.string().uuid(),

  key: z.string(),

  section: z.string(),

  topic: z.string().nullable(),

  region: z.string().nullable(),

  question: z.string(),

  answer: z.string(),

  notices: z.array(z.string()),

  footnotes: z.array(z.string()),

  tags: z.array(z.string()),

  content: z.string(),
});

export type StoreKnowledgeQdrantPayload = z.infer<
  typeof StoreKnowledgeQdrantPayloadSchema
>;
