import { SupportAgentStateType } from '../support-agent.state';

export type AfterIntentRoute =
  | 'orchestrator'
  | 'reject'
  | 'clarificationTopic'
  | 'clarificationQuestion';

export function afterIntentRoute(
  state: SupportAgentStateType,
): AfterIntentRoute {
  const decision = state.intentRouter;

  if (!decision) {
    throw new Error('AfterIntentRoute: отсутствует результат IntentRouter');
  }

  if (decision.route === 'orchestrator') {
    return 'orchestrator';
  }

  if (decision.route === 'unsupported') {
    return 'reject';
  }

  /**
   * IntentRouter отправил запрос
   * на clarification.
   */
  if (!decision.clarificationTopic) {
    /**
     * Тема неизвестна.
     *
     * Сначала спрашиваем категорию.
     */
    return 'clarificationTopic';
  }

  /**
   * Тема известна.
   *
   * Сразу спрашиваем конкретный вопрос.
   */
  return 'clarificationQuestion';
}
