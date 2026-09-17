import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { AIMessage } from '@langchain/core/messages';
import type { GraphNode, LangGraphRunnableConfig } from '@langchain/langgraph';
import { AiService } from '@/src/ai/ai.service';
import { aggregateSupportAnswerPrompt } from '../../prompts/aggregate-support-answer.prompt';
import {
  AggregateFinalAnswerSchema,
  type SupportAgentAnswerBlock,
} from '../../schemas/support-agent-answer.schema';
import { SupportAgentState } from '../support-agent.state';

const blockOrder: Record<SupportAgentAnswerBlock['worker'], number> = {
  customer_help: 0,
  product_search: 1,
};

export function createAggregateFinalAnswerNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getYandexLiteChatModel();

  return async (state, config: LangGraphRunnableConfig) => {
    const blocks = [...state.workerResults].sort(
      (left, right) => blockOrder[left.worker] - blockOrder[right.worker],
    );

    if (blocks.length < 2) {
      throw new Error(
        `AggregateFinalAnswerNode: ожидалось минимум 2 worker results, получено ${blocks.length}`,
      );
    }

    const pendingQuestion =
      state.productContext?.pendingClarification?.question ?? null;

    const workerResultsForPrompt = blocks.map((block) => {
      if (block.worker === 'customer_help') {
        return {
          worker: block.worker,
          data: { message: block.data.message },
        };
      }

      const productMessage =
        block.data.consultation?.message ??
        (pendingQuestion === block.data.message
          ? 'Для продолжения подбора требуется уточнение.'
          : block.data.message);

      return {
        worker: block.worker,
        data: {
          message: productMessage,
          groups: block.data.groups.map((group) => ({
            query: group.query,
            message: group.message,
            productsCount: group.products.length,
          })),
        },
      };
    });

    await dispatchCustomEvent(
      'assistant_status',
      { status: 'GENERATING_ANSWER' },
      config,
    );

    const prompt = await aggregateSupportAnswerPrompt.invoke({
      query: state.query,
      workerResults: JSON.stringify(workerResultsForPrompt, null, 2),
    });

    const stream = await model.stream(prompt);
    let message = '';

    for await (const chunk of stream) {
      const delta = chunk.text;

      if (!delta) continue;

      message += delta;

      await dispatchCustomEvent('assistant_delta', { delta }, config);
    }

    if (!message.trim()) {
      throw new Error(
        'AggregateFinalAnswerNode: модель не вернула финальный текст',
      );
    }

    if (pendingQuestion) {
      const delta = `\n\n${pendingQuestion}`;
      message += delta;

      await dispatchCustomEvent('assistant_delta', { delta }, config);
    }

    const answer = AggregateFinalAnswerSchema.parse({
      type: 'aggregate',
      message,
      blocks,
    });

    return {
      answer,
      messages: [new AIMessage(answer.message)],
    };
  };
}
