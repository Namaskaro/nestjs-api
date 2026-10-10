import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { ProductAgentService } from '../product-agent.service';

import {
  ProductAgentState,
  type ProductAgentStateType,
} from '../product-agent.state';

import { createConsultationAgent } from '../../consultation-agent/consultation.agent';

import { CATEGORY_USAGE_KNOWLEDGE } from '../../../core/profiles/usage-scenarios';

function compactUsageScenarioKnowledge() {
  return CATEGORY_USAGE_KNOWLEDGE.map((knowledge) => ({
    profileId: knowledge.profileId,
    scenarios: knowledge.scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      signals: scenario.signals,
    })),
  }));
}

function compactWorkspaceTask(
  task: ProductAgentStateType['workspace']['tasks'][number],
) {
  const state = task.record.state;
  const snapshot = task.record.results.active;

  return {
    taskId: task.taskId,
    query: task.query,
    question: task.question,
    search: state?.search ?? null,
    memory: state
      ? {
          goals: state.memory.memory.goals.map((goal) => ({
            text: goal.text,
            importance: goal.importance,
          })),
          criteria: state.memory.memory.criteria.map((criterion) => ({
            attributeId: criterion.attributeId,
            operator: criterion.operator,
            value: criterion.value,
            unit: criterion.unit,
            importance: criterion.importance,
            sourceText: criterion.sourceText,
          })),
        }
      : null,
    results: snapshot
      ? {
          count: snapshot.products.length,
          products: snapshot.products.slice(0, 25).map((product, index) => ({
            position: index + 1,
            title: product.title,
          })),
        }
      : null,
    lastComparison: task.lastComparison
      ? {
          positions: task.lastComparison.positions,
        }
      : null,
  };
}

export function createDecideProductNode(
  aiService: AiService,
  productAgentService: ProductAgentService,
): GraphNode<typeof ProductAgentState> {
  const consultant = createConsultationAgent(aiService);

  return async (state) => {
    if (state.workspace.processedRequestIds.includes(state.requestId)) {
      return {
        plan: null,
      };
    }

    const plan = await consultant.decideWorkspace({
      currentMessage: state.query,
      pendingClarification: state.workspace.pendingClarification,
      tasks: state.workspace.tasks.map(compactWorkspaceTask),
      focus: state.workspace.focus.map((focus) => ({
        taskId: focus.taskId,
        positions: focus.positions,
      })),
      searchCapabilities: productAgentService.capabilities(),
      usageScenarios: compactUsageScenarioKnowledge(),
    });

    return {
      plan,
    };
  };
}
