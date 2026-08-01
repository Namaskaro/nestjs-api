import { AIMessage } from '@langchain/core/messages';
import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { SupportAgentState } from '../support-agent.state';

import { AggregateSupportAnswerSchema } from '../../schemas/aggregate-support-answer.schema';

import {
  SupportAgentAnswerBlock,
  SupportAgentAnswerSchema,
} from '../../schemas/support-agent-answer.schema';

import { aggregateSupportAnswerPrompt } from '../../prompts/aggregate-support-answer.prompt';

export function createAggregateFinalAnswerNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getChatModel('yandex');

  /**
   * Модель формирует только общий текст.
   *
   * Точные структурированные блоки
   * будут добавлены обычным TypeScript-кодом.
   */
  const structuredAggregator = model.withStructuredOutput(
    AggregateSupportAnswerSchema,
    {
      name: 'aggregate_support_answer',
    },
  );

  const chain = aggregateSupportAnswerPrompt.pipe(structuredAggregator);

  return async (state) => {
    /**
     * Не отправляем модели служебные FAQ-поля:
     *
     * - id;
     * - code;
     * - similarity.
     *
     * Для ответа нужны только вопрос и содержание ответа.
     */
    const faqResults = state.faqResults.map((result) => ({
      question: result.question,
      answer: result.answer,
    }));

    /**
     * Не отправляем в общий LLM-финализатор
     * полные объекты всех товаров.
     *
     * Product-agent уже сформировал свой результат,
     * а точные карточки будут добавлены в blocks.
     */
    const productSearchSummary = state.productSearchResult
      ? {
          message: state.productSearchResult.message,

          groups: state.productSearchResult.groups.map((group) => ({
            query: group.query,
            message: group.message,
            productsCount: group.products.length,
          })),
        }
      : null;

    const workerResults = {
      faqResults,
      productSearch: productSearchSummary,
    };

    const aggregatedResult = await chain.invoke({
      query: state.query,

      workerResults: JSON.stringify(workerResults, null, 2),
    });

    /**
     * Сюда постепенно будут добавляться
     * все типы структурированных ответов.
     */
    const blocks: SupportAgentAnswerBlock[] = [];

    if (state.productSearchResult) {
      blocks.push({
        type: 'product_search',

        /**
         * Берём точный результат product-agent.
         *
         * LLM его не переписывает.
         */
        data: state.productSearchResult,
      });
    }

    const answer = SupportAgentAnswerSchema.parse({
      message: aggregatedResult.message,
      blocks,
    });

    return {
      answer,

      /**
       * В историю записываем видимую
       * текстовую часть ответа.
       */
      messages: [new AIMessage(answer.message)],
    };
  };
}
