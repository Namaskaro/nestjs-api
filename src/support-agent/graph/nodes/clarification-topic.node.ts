import { interrupt, type GraphNode } from '@langchain/langgraph';

import { SupportAgentState } from '../support-agent.state';

import { ClarificationNodeSchema } from '../../schemas/clarification-response.schema';

import { clarificationTopicOptions } from '../../config/clarification.config';

import { ClarificationTopicResumeSchema } from '../../schemas/clarification-resume.schema';

export const clarificationTopicNode: GraphNode<typeof SupportAgentState> = (
  state,
) => {
  const question =
    state.rejectCount > 0
      ? 'Давайте выберем тему, с которой я могу помочь.'
      : 'Подскажите, пожалуйста, с чем связан ваш запрос?';

  const interruptPayload = ClarificationNodeSchema.parse({
    kind: 'topics',

    question,

    topic: null,

    options: clarificationTopicOptions,
  });

  const rawResumeValue = interrupt(interruptPayload);

  const resumeValue = ClarificationTopicResumeSchema.parse(rawResumeValue);

  return {
    clarification: resumeValue.topic,
  };
};
