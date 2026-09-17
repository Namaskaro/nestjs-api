import { z } from 'zod';

export const StoreKnowledgeImportItemSchema = z.object({
  id: z.string().min(1),

  category: z.string().min(1),

  topic: z.string().min(1).nullable().optional(),

  question: z.string().min(1),

  answer: z.string().min(1),

  notice: z.string().min(1).nullable().optional(),

  footnote: z.string().min(1).nullable().optional(),

  tags: z.array(z.string().min(1)),
});

export const StoreKnowledgeImportSchema = z.object({
  items: z.array(StoreKnowledgeImportItemSchema),
});
