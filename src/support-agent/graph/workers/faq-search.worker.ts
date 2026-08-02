import { AiService } from '@/src/ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';

import type { GraphNode } from '@langchain/langgraph';

import type { FaqSearchResult } from '../../schemas/faq-search-result.schema';

import { FaqSearchAnswerBlockSchema } from '../../schemas/support-agent-answer.schema';

import { SupportAgentState } from '../support-agent.state';

export function createFaqSearchWorker(
  aiService: AiService,
  prismaService: PrismaService,
): GraphNode<typeof SupportAgentState> {
  return async (state) => {
    const queryEmbedding = await aiService.createEmbedding(state.query);

    const vector = `[${queryEmbedding.join(',')}]`;

    const faqResults = await prismaService.$queryRaw<FaqSearchResult[]>`
      SELECT
        id,
        code,
        question,
        answer,
        1 - (embedding <=> ${vector}::vector) AS similarity
      FROM "FaqKnowledge"
      WHERE "isActive" = true
      ORDER BY embedding <=> ${vector}::vector
      LIMIT 5
    `;

    const workerResult = FaqSearchAnswerBlockSchema.parse({
      worker: 'faq_worker',

      data: faqResults,
    });

    return {
      workerResults: [workerResult],
    };
  };
}
