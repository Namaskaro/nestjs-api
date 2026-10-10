import { AIMessage, HumanMessage } from '@langchain/core/messages';

import { Command, END, interrupt, type GraphNode } from '@langchain/langgraph';

import {
  StoreKnowledgeService,
  type StoreKnowledgeSearchResult,
} from '@/src/store-knowledge/store-knowledge.service';

import { SupportAgentState } from '../support-agent.state';
import {
  clarificationConfig,
  filterAvailableClarificationQuestions,
  getKnowledgeKeys,
} from '../../config/clarification.config';
import { ClarificationNodeSchema } from '../../schemas/clarification-response.schema';
import {
  ClarificationCustomQuestionResumeSchema,
  ClarificationQuestionResumeSchema,
} from '../../schemas/clarification-resume.schema';
import { CustomerHelpFinalAnswerSchema } from '../../schemas/support-agent-answer.schema';
import { RequestRouterSchema } from '../../schemas/request-router.schema';

function knowledgeAnswer(knowledge: StoreKnowledgeSearchResult): string {
  return [
    knowledge.answer,
    knowledge.notice ? `Важно: ${knowledge.notice}` : null,
    knowledge.footnote ? `Примечание: ${knowledge.footnote}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
}

function resetResolvedClarification(query: string) {
  return {
    query,
    rejectCount: 0,
    preIntentRoute: null,
    clarification: null,
    requestRouter: null,
    workerResults: [],
    answer: null,
    handoffRequest: null,
    handoff: null,
  };
}

export function createClarificationQuestionNode(
  storeKnowledgeService: StoreKnowledgeService,
): GraphNode<typeof SupportAgentState> {
  return async (state) => {
    const topic =
      state.clarification ?? state.requestRouter?.clarificationTopic;

    if (!topic) {
      throw new Error(
        'ClarificationQuestionNode: clarification topic отсутствует',
      );
    }

    const topicConfig = clarificationConfig[topic];

    const activeKnowledgeKeys = await storeKnowledgeService.findActiveKeys(
      getKnowledgeKeys(topicConfig.questions),
    );

    const availableQuestions = filterAvailableClarificationQuestions(
      topicConfig.questions,
      activeKnowledgeKeys,
    );

    const interruptPayload = ClarificationNodeSchema.parse({
      kind: 'questions',
      question: `Хорошо. Что именно вас интересует по теме «${topicConfig.label}»?`,
      topic,
      options: availableQuestions.map(({ id, label }) => ({
        id,
        label,
      })),
    });

    const rawResumeValue = interrupt(interruptPayload);

    const resumeValue = ClarificationQuestionResumeSchema.parse(rawResumeValue);

    if (resumeValue.kind === 'custom_question') {
      const concreteQuery = resumeValue.text;

      return new Command({
        goto: 'preIntentNode',
        update: {
          ...resetResolvedClarification(concreteQuery),
          messages: [new HumanMessage(concreteQuery)],
        },
      });
    }

    const selectedQuestion = availableQuestions.find(
      (question) => question.id === resumeValue.questionId,
    );

    if (!selectedQuestion) {
      throw new Error(
        `ClarificationQuestionNode: вопрос ${resumeValue.questionId} недоступен`,
      );
    }

    if (selectedQuestion.resolution.kind === 'product_input') {
      const customInputPayload = ClarificationNodeSchema.parse({
        kind: 'custom_input',
        question:
          'Опишите, какой товар вам нужен. Например: тип товара, цвет, размер, сезон или бренд.',
        topic,
        options: [],
      });

      const rawCustomInput = interrupt(customInputPayload);

      const customInput =
        ClarificationCustomQuestionResumeSchema.parse(rawCustomInput);

      const concreteQuery = customInput.text;

      return new Command({
        goto: 'preIntentNode',
        update: {
          ...resetResolvedClarification(concreteQuery),
          messages: [new HumanMessage(concreteQuery)],
        },
      });
    }

    const concreteQuery = selectedQuestion.label;

    if (selectedQuestion.resolution.kind === 'knowledge') {
      const knowledge = await storeKnowledgeService.findByKey(
        selectedQuestion.resolution.knowledgeKey,
      );

      const message = knowledge
        ? knowledgeAnswer(knowledge)
        : 'Информация по этому вопросу сейчас недоступна.';

      const answer = CustomerHelpFinalAnswerSchema.parse({
        type: 'customer_help',
        message,
      });

      return new Command({
        goto: END,
        update: {
          ...resetResolvedClarification(concreteQuery),
          activeAgent: 'customerHelpAgent',
          executionMode: 'single',
          answer,
          messages: [
            new HumanMessage(concreteQuery),
            new AIMessage(answer.message),
          ],
        },
      });
    }

    if (selectedQuestion.resolution.kind === 'product_agent') {
      return new Command({
        goto: 'productAgent',
        update: {
          ...resetResolvedClarification(concreteQuery),
          activeAgent: null,
          executionMode: 'single',
          messages: [new HumanMessage(concreteQuery)],
        },
      });
    }

    const requestRouter = RequestRouterSchema.parse({
      route: 'execute',
      workers: ['orderAgent'],
      workerQueries: {
        productAgent: null,
        orderAgent: concreteQuery,
        customerHelpAgent: null,
      },
      orderRequest: selectedQuestion.resolution.orderRequest,
      clarificationTopic: null,
      handoffRequest: null,
      reason: 'Пользователь выбрал готовое действие по заказу.',
    });

    return new Command({
      goto: 'orderAgent',
      update: {
        ...resetResolvedClarification(concreteQuery),
        activeAgent: null,
        executionMode: 'single',
        requestRouter,
        messages: [new HumanMessage(concreteQuery)],
      },
    });
  };
}
