import type { GraphNode } from '@langchain/langgraph';
import { AiService } from '@/src/ai/ai.service';
import { ProductAgentService } from '../product-agent.service';
import { ProductAgentState } from '../product-agent.state';
import { createConsultationAgent } from '../../consultation-agent/consultation.agent';
import { buildProductConsultationContext } from '../../context/product-consultation-context';
import { createConsultationApplicationRecord } from '../../runtime/consultation-application-record';

export function createDecideProductNode(
  aiService: AiService,
  productAgentService: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  const consultant = createConsultationAgent(aiService);
  return async (state) => {
    if (state.workspace.processedRequestIds.includes(state.requestId))
      return { plan: null };
    const context = (
      record: ReturnType<typeof createConsultationApplicationRecord>,
    ) =>
      buildProductConsultationContext({
        record,
        currentMessage: state.query,
        recentMessages: [],
        searchCapabilities: productAgentService.capabilities(),
      }).context;
    const plan = await consultant.decideWorkspace({
      currentMessage: state.query,
      pendingClarification: state.workspace.pendingClarification,
      tasks: state.workspace.tasks.map((task) => ({
        taskId: task.taskId,
        query: task.query,
        question: task.question,
        lastComparison: task.lastComparison
          ? { positions: task.lastComparison.positions }
          : null,
        context: context(task.record),
      })),
      focus: state.workspace.focus.map((focus) => ({
        taskId: focus.taskId,
        positions: focus.positions,
      })),
      emptyTaskContext: context(createConsultationApplicationRecord()),
    });
    return { plan };
  };
}
