import { AiService } from '@/src/ai/ai.service';
import { GraphNode } from '@langchain/langgraph';
import { SupportAgentState } from '../support-agent.state';
import { OrchestratorSchema } from '../../schemas/orchestrator.schema';
import { orchestratorPrompt } from '../../prompts/orchestrator.prompt';

export function createOrchestratorNode(
  aiService: AiService,
): GraphNode<typeof SupportAgentState> {
  const model = aiService.getChatModel('yandex');

  const structuredOrchestrator = model.withStructuredOutput(
    OrchestratorSchema,
    {
      name: 'orchestrate_workers',
    },
  );

  const chain = orchestratorPrompt.pipe(structuredOrchestrator);

  return async (state) => {
    const orchestrator = await chain.invoke({ query: state.query });

    return {
      orchestrator,
    };
  };
}
