import { tool } from 'langchain';
import { z } from 'zod';

import { StoreKnowledgeService } from '@/src/store-knowledge/store-knowledge.service';

export function createSearchKnowledgeTool(
  storeKnowledgeService: StoreKnowledgeService,
) {
  return tool(
    async ({ query }) => {
      const result = await storeKnowledgeService.search(query);

      // НОВОЕ:
      // Явно сообщаем агенту, если подходящего знания не найдено.
      // Это понадобится позже для повторного поиска,
      // clarification или handoff.
      if (!result) {
        return JSON.stringify({
          found: false,
        });
      }

      // НОВОЕ:
      // Возвращаем один лучший knowledge result,
      // а не массив из нескольких документов.
      return JSON.stringify(
        {
          found: true,
          result,
        },
        null,
        2,
      );
    },
    {
      name: 'search_knowledge',

      description:
        'Ищет один наиболее релевантный ответ в базе знаний интернет-магазина по вопросам доставки, оплаты, возвратов, обмена, скидок, программы лояльности, товаров и других правил магазина.',

      schema: z.object({
        query: z
          .string()
          .min(1)
          .describe(
            'Конкретный поисковый запрос по базе знаний интернет-магазина',
          ),
      }),
    },
  );
}
