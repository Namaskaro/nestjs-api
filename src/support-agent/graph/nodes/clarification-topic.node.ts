import { interrupt, type GraphNode } from '@langchain/langgraph';

import { StoreKnowledgeService } from '@/src/store-knowledge/store-knowledge.service';

import { SupportAgentState } from '../support-agent.state';
import { ClarificationNodeSchema } from '../../schemas/clarification-response.schema';
import { ClarificationTopicResumeSchema } from '../../schemas/clarification-resume.schema';
import {
  clarificationConfig,
  clarificationTopicOrder,
  filterAvailableClarificationQuestions,
  getKnowledgeKeys,
} from '../../config/clarification.config';

export function createClarificationTopicNode(
  storeKnowledgeService: StoreKnowledgeService,
): GraphNode<typeof SupportAgentState> {
  return async (state) => {
    const knowledgeKeys = clarificationTopicOrder.flatMap((topic) =>
      getKnowledgeKeys(clarificationConfig[topic].questions),
    );

    const activeKnowledgeKeys = await storeKnowledgeService.findActiveKeys(
      knowledgeKeys,
    );

    const options = clarificationTopicOrder
      .filter((topic) => {
        const availableQuestions = filterAvailableClarificationQuestions(
          clarificationConfig[topic].questions,
          activeKnowledgeKeys,
        );

        return availableQuestions.length > 0;
      })
      .map((topic) => ({
        id: topic,
        label: clarificationConfig[topic].label,
      }));

    const question =
      state.rejectCount > 0
        ? 'Давайте выберем тему, с которой я могу помочь.'
        : 'Подскажите, пожалуйста, с чем связан ваш запрос?';

    const interruptPayload = ClarificationNodeSchema.parse({
      kind: 'topics',
      question,
      topic: null,
      options,
    });

    const rawResumeValue = interrupt(interruptPayload);

    const resumeValue = ClarificationTopicResumeSchema.parse(rawResumeValue);

    return {
      clarification: resumeValue.topic,
    };
  };
}
