import { AiService } from '@/src/ai/ai.service';
import { ProductAgentState } from '../../product-agent.state';
import { GraphNode } from '@langchain/langgraph';
import { NormalizeQuerySchema } from '../../schemas/normalize-query.schema';
import { normalizeProductQueryPrompt } from '../../prompts/normalize-query.prompt';

export function createNormalizeQueryNode(
  aiService: AiService,
): GraphNode<typeof ProductAgentState> {
  const model = aiService.getChatModel('yandex');

  const structuredNormalizer = model.withStructuredOutput(
    NormalizeQuerySchema,
    {
      name: 'normalize_query',
    },
  );

  return async (state) => {
    const promptValue = await normalizeProductQueryPrompt.invoke({
      query: state.query,
    });

    const result = await structuredNormalizer.invoke(promptValue);

    return {
      normalizedQueries: result.queries,
    };
  };
}
