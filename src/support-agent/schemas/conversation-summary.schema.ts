// START ИЗМЕНЕНИЙ — CONVERSATION SUMMARY SCHEMA

import { z } from 'zod';

export const ConversationSummarySchema = z.object({
  general: z.string().nullable(),

  product: z.string().nullable(),

  customerHelp: z.string().nullable(),

  orders: z.string().nullable(),

  unresolved: z.string().nullable(),
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const EMPTY_CONVERSATION_SUMMARY: ConversationSummary = {
  general: null,

  product: null,

  customerHelp: null,

  orders: null,

  unresolved: null,
};

// END ИЗМЕНЕНИЙ — CONVERSATION SUMMARY SCHEMA
