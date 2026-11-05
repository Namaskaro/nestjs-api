import { Logger } from '@nestjs/common';

import { HumanMessage } from '@langchain/core/messages';

import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { handoffHistoryTrimmer } from '@/src/support-agent/context/history-context';

import { HandoffState } from '../handoff-agent.state';

import { prepareHandoffPrompt } from '../prompts/prepare-handoff.prompt';

import {
  HandoffContextSchema,
  HandoffEvidenceSchema,
  type HandoffContext,
  type HandoffEvidence,
  type HandoffRequest,
} from '../schemas/handoff.schema';

const logger = new Logger('PrepareHandoffNode');

/**
 * Получаем последнюю реплику покупателя.
 *
 * Используется только для резервного описания.
 * Она не считается проверенным фактом.
 */
function lastCustomerMessage(
  messages: typeof HandoffState.State.messages,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!HumanMessage.isInstance(message)) {
      continue;
    }

    const text = message.text.trim();

    if (text) {
      return text.slice(0, 600);
    }
  }

  return null;
}

/**
 * Резервный контекст.
 *
 * Если LLM не ответила, оператор всё равно
 * получит обращение и известные системе данные.
 */
function createFallbackContext(
  request: HandoffRequest,
  evidence: HandoffEvidence | null,
  customerMessage: string | null,
): HandoffContext {
  const issue =
    evidence?.userReportedIssue ??
    (customerMessage
      ? `Обращение покупателя: ${customerMessage}`
      : 'Покупатель запросил помощь оператора');

  const userGoal =
    evidence?.requestedOutcome ??
    (request.reason === 'CUSTOMER_REQUEST'
      ? 'Связаться с оператором'
      : 'Получить помощь сотрудника магазина');

  const unresolvedQuestions = evidence?.unresolvedQuestions.length
    ? evidence.unresolvedQuestions
    : ['Уточнить обстоятельства обращения'];

  return HandoffContextSchema.parse({
    issue,
    userGoal,

    verifiedFacts: evidence?.verifiedFacts ?? [],

    actionsTaken: evidence?.actionsTaken ?? [],

    unresolvedQuestions,

    relatedEntities: evidence?.relatedEntities ?? null,
  });
}

/**
 * Объединяем результат LLM с проверенными
 * данными специализированного компонента.
 *
 * ВАЖНО:
 * LLM не является источником verifiedFacts,
 * actionsTaken и идентификаторов.
 */
function mergeContext(
  generated: HandoffContext,
  evidence: HandoffEvidence | null,
): HandoffContext {
  return HandoffContextSchema.parse({
    issue: evidence?.userReportedIssue ?? generated.issue,

    userGoal: evidence?.requestedOutcome ?? generated.userGoal,

    verifiedFacts: evidence?.verifiedFacts ?? [],

    actionsTaken: evidence?.actionsTaken ?? [],

    unresolvedQuestions: evidence?.unresolvedQuestions.length
      ? evidence.unresolvedQuestions
      : generated.unresolvedQuestions,

    relatedEntities: evidence?.relatedEntities ?? null,
  });
}

export function createPrepareHandoffNode(
  aiService: AiService,
): GraphNode<typeof HandoffState> {
  const model = aiService.getChatModel('STANDARD');

  const structuredModel = model.withStructuredOutput(HandoffContextSchema, {
    name: 'prepare_handoff_context',
  });

  const chain = prepareHandoffPrompt.pipe(structuredModel);

  return async (state) => {
    if (!state.handoffRequest) {
      throw new Error(
        'PrepareHandoffNode: отсутствует запрос на передачу оператору',
      );
    }

    const request = state.handoffRequest;

    const evidence = request.evidence
      ? HandoffEvidenceSchema.parse(request.evidence)
      : null;

    const history = await handoffHistoryTrimmer.invoke(state.messages);

    const conversation = history
      .map((message, index) => {
        const content =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);

        return `${index + 1}. [${message.getType()}] ${content}`;
      })
      .join('\n');

    const customerMessage = lastCustomerMessage(state.messages);

    const fallback = createFallbackContext(request, evidence, customerMessage);

    let preparedContext: HandoffContext;

    try {
      const generated = HandoffContextSchema.parse(
        await chain.invoke({
          reason: request.reason,

          trigger: request.trigger,

          source: evidence?.source ?? 'requestRouter',

          reportedIssue: evidence?.userReportedIssue ?? 'Не указано',

          requestedOutcome: evidence?.requestedOutcome ?? 'Не указано',

          evidence: JSON.stringify(
            {
              verifiedFacts: evidence?.verifiedFacts ?? [],

              actionsTaken: evidence?.actionsTaken ?? [],

              unresolvedQuestions: evidence?.unresolvedQuestions ?? [],

              relatedEntities: evidence?.relatedEntities ?? null,
            },
            null,
            2,
          ),

          conversation: conversation || 'История разговора отсутствует.',
        }),
      );

      preparedContext = mergeContext(generated, evidence);
    } catch (error) {
      /*
       * Ошибка подготовки текста не должна
       * блокировать обращение к оператору.
       *
       * Не выводим полный текст разговора
       * или персональные данные в лог.
       */
      logger.warn(
        'Не удалось подготовить Handoff Context через LLM. ' +
          'Используется резервный контекст.',
      );

      preparedContext = fallback;
    }

    return {
      preparedContext,

      preparationStatus: 'READY',
    };
  };
}
