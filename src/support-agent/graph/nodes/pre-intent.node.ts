import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import type { GraphNode, LangGraphRunnableConfig } from '@langchain/langgraph';

import { SupportAgentState } from '../support-agent.state';

export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[!?.,;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

const DIRECT_CLARIFICATION_PATTERNS = [
  /^(привет|здравствуй|здравствуйте|хай|hello|hi)$/iu,

  /^(доброе утро|добрый день|добрый вечер)$/iu,

  /^(помоги|помогите|нужна помощь|мне нужна помощь)$/iu,

  /^(можешь помочь|можете помочь)$/iu,
];

const OFF_TOPIC_PATTERNS = [
  /(?:напиши|создай|сгенерируй|реализуй).{0,40}(?:код|функци|класс|алгоритм|javascript|typescript|python|java|react|sql)/iu,

  /(?:реши|решить|посчитай|вычисли).{0,40}(?:уравнен|математ|пример|задач)/iu,

  /(?:напиши|сочини|придумай).{0,40}(?:стих|рассказ|сказк|анекдот|поздравлен|эссе|сочинен)/iu,

  /(?:объясни|расскажи).{0,40}(?:javascript|typescript|python|react|nestjs|langgraph)/iu,

  /(?:кто\s+(?:сейчас\s+)?президент|реши\s+\d+\s*[+\-*/]\s*\d+)/iu,
];

const PROFANITY_WORD =
  '(?:сука|бля(?:дь|ть)?|хуй(?:ня)?|нахуй|пиздец|ебать|заебал(?:и)?|долбо[её]б|мудак|мразь)';

const PROFANITY_ONLY_PATTERNS = [
  new RegExp(`^${PROFANITY_WORD}(?:\\s+${PROFANITY_WORD})*$`, 'iu'),

  /^(?:иди|пош[её]л|пошли)\s+нахуй$/iu,

  /^(?:я\s+)?ебал(?:\s+вас)?(?:\s+в\s+рот)?$/iu,
];

function isSpam(query: string): boolean {
  const compactQuery = query.replace(/\s/g, '');

  return (
    query.length === 0 ||
    /^(.)\1{6,}$/u.test(compactQuery) ||
    /^(\p{L}+)(?:\s+\1){3,}$/iu.test(query)
  );
}

export const preIntentNode: GraphNode<typeof SupportAgentState> = async (
  state,
  config: LangGraphRunnableConfig,
) => {
  const query = normalizeQuery(state.query);

  await dispatchCustomEvent(
    'assistant_status',
    {
      status: 'THINKING',
    },
    config,
  );

  const resetRunState = {
    requestRouter: null,

    clarification: null,

    executionMode: null,

    workerResults: [],

    handoffRequest: null,

    handoff: null,

    answer: null,
  };

  const stickyExecutionMode = state.activeAgent ? 'single' : null;

  if (DIRECT_CLARIFICATION_PATTERNS.some((pattern) => pattern.test(query))) {
    return {
      ...resetRunState,

      executionMode: stickyExecutionMode,

      preIntentRoute: 'clarificationTopic',

      rejectCount: 0,
    };
  }

  const shouldReject =
    isSpam(query) ||
    OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(query)) ||
    PROFANITY_ONLY_PATTERNS.some((pattern) => pattern.test(query));

  if (!shouldReject) {
    return {
      ...resetRunState,

      executionMode: stickyExecutionMode,

      preIntentRoute: 'requestRouterNode',
    };
  }

  return {
    ...resetRunState,

    preIntentRoute: state.rejectCount > 0 ? 'clarificationTopic' : 'reject',
  };
};
