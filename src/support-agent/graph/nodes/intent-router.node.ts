import { AiService } from '@/src/ai/ai.service';
import { GraphNode } from '@langchain/langgraph';
import { SupportAgentState } from '../support-agent.state';
import { IntentRouterSchema } from '../../schemas/intent-router.schema';
import { intentRouterPrompt } from '../../prompts/intent-router.prompt';

export function createIntentRouterNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getChatModel('yandex');

  const structuredRouter = model.withStructuredOutput(IntentRouterSchema, {
    name: 'route_store_request',
  });

  const chain = intentRouterPrompt.pipe(structuredRouter);

  return async (state) => {
    const decision = await chain.invoke({
      query: state.query,
    });

    return {
      intentRouter: decision,

      clarification: null,

      orchestrator: null,

      faqResults: [],

      productSearchResult: null,

      answer: null,
    };
  };
}
