import { AiService } from '@/src/ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';

import { GraphNode } from '@langchain/langgraph';

import { FaqSearchResult } from '../../schemas/faq-search-result.schema';
import { SupportAgentState } from '../support-agent.state';

export function createFaqSearchWorker(
  aiService: AiService,
  prismaService: PrismaService,
): GraphNode<typeof SupportAgentState> {
  return async (state) => {
    /**
     * 1. Создаём embedding пользовательского запроса.
     */
    const queryEmbedding = await aiService.createEmbedding(state.query);

    /**
     * 2. Преобразуем number[] в строковый формат pgvector.
     */
    const vector = `[${queryEmbedding.join(',')}]`;

    /**
     * 3. Ищем пять ближайших FAQ.
     */
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

    /**
     * 4. Записываем результаты поиска в общий state.
     */
    return {
      faqResults,
    };
  };
}
