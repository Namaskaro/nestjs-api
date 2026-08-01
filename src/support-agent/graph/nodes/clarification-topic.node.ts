import { interrupt, type GraphNode } from '@langchain/langgraph';
import { SupportAgentState } from '../support-agent.state';
import { ClarificationNodeSchema } from '../../schemas/clarification-response.schema';
import { clarificationTopicOptions } from '../../config/clarification.config';
import { ClarificationTopicResumeSchema } from '../../schemas/clarification-resume.schema';

export const clarificationTopicNode: GraphNode<typeof SupportAgentState> = (
  state,
) => {
  const decision = state.intentRouter;

  if (!decision) {
    throw new Error(
      'ClarificationTopicNode: отсутствует результат IntentRouter',
    );
  }

  if (decision.route !== 'clarification') {
    throw new Error(
      `ClarificationTopicNode: получен неправильный маршрут ${decision.route}`,
    );
  }

  /**
   * Если IntentRouter уже определил тему,
   * эта нода вообще не должна была запускаться.
   */
  if (decision.clarificationTopic) {
    throw new Error('ClarificationTopicNode: тема уже определена IntentRouter');
  }

  const question = 'Уточните, пожалуйста, тему вашего вопроса.';

  /**
   * Формируем данные, которые получит frontend.
   */
  const interruptPayload = ClarificationNodeSchema.parse({
    kind: 'topics',

    question,

    topic: null,

    options: clarificationTopicOptions,
  });

  /**
   * Первый запуск:
   *
   * interrupt() остановит выполнение графа.
   *
   * После resume:
   *
   * interrupt() вернёт значение,
   * которое frontend передал в Command({ resume }).
   */
  const rawResumeValue = interrupt(interruptPayload);

  /**
   * Проверяем ответ frontend.
   */
  const resumeValue = ClarificationTopicResumeSchema.parse(rawResumeValue);

  /**
   * Сохраняем выбранную категорию в state.
   *
   * После этой ноды граф перейдёт
   * в clarificationQuestionNode.
   */
  return {
    clarification: resumeValue.topic,
  };
};
