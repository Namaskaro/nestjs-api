import { HumanMessage } from '@langchain/core/messages';

import { interrupt, type GraphNode } from '@langchain/langgraph';

import { SupportAgentState } from '../support-agent.state';

import { clarificationConfig } from '../../config/clarification.config';

import { ClarificationNodeSchema } from '../../schemas/clarification-response.schema';
import {
  ClarificationCustomQuestionResumeSchema,
  ClarificationQuestionResumeSchema,
} from '../../schemas/clarification-resume.schema';

const PRODUCT_SEARCH_HELP_QUESTION_ID = 'product_search_help';

export const clarificationQuestionNode: GraphNode<typeof SupportAgentState> = (
  state,
) => {
  const decision = state.intentRouter;

  if (!decision) {
    throw new Error(
      'ClarificationQuestionNode: отсутствует результат IntentRouter',
    );
  }

  if (decision.route !== 'clarification') {
    throw new Error(
      `ClarificationQuestionNode: получен неправильный маршрут ${decision.route}`,
    );
  }

  const topic = state.clarification ?? decision.clarificationTopic;

  if (!topic) {
    throw new Error('ClarificationQuestionNode: тема уточнения не определена');
  }

  const topicConfig = clarificationConfig[topic];

  const interruptPayload = ClarificationNodeSchema.parse({
    kind: 'questions',

    question: `Что именно вас интересует по теме ` + `«${topicConfig.label}»?`,

    topic,

    options: topicConfig.questions,
  });

  const rawResumeValue = interrupt(interruptPayload);

  const resumeValue = ClarificationQuestionResumeSchema.parse(rawResumeValue);

  let concreteQuery: string;

  if (resumeValue.kind === 'question_selected') {
    const selectedQuestion = topicConfig.questions.find(
      (questionOption) => questionOption.id === resumeValue.questionId,
    );

    if (!selectedQuestion) {
      throw new Error(
        `ClarificationQuestionNode: вопрос ${resumeValue.questionId} не найден`,
      );
    }

    if (selectedQuestion.id === PRODUCT_SEARCH_HELP_QUESTION_ID) {
      const customInputPayload = ClarificationNodeSchema.parse({
        kind: 'custom_input',

        question:
          'Опишите, какой товар вам нужен. ' +
          'Например: тип товара, цвет, размер, сезон или бренд.',

        topic,

        options: [],
      });

      const rawCustomInput = interrupt(customInputPayload);

      const customInput =
        ClarificationCustomQuestionResumeSchema.parse(rawCustomInput);

      concreteQuery = customInput.text;
    } else {
      concreteQuery = selectedQuestion.label;
    }
  } else {
    concreteQuery = resumeValue.text;
  }

  return {
    query: concreteQuery,

    messages: [new HumanMessage(concreteQuery)],

    clarification: null,

    intentRouter: null,

    orchestrator: null,

    workerResults: [],

    answer: null,
  };
};
