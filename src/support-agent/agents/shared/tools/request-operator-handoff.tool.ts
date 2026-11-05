import { tool } from '@langchain/core/tools';

import { Command } from '@langchain/langgraph';

import { z } from 'zod';

import { HandoffRequestSchema } from '../../handoff-agent/schemas/handoff.schema';

/**
 * Инструмент передачи разговора оператору.
 *
 * CustomerHelpAgent может сообщить:
 * - причину передачи;
 * - проблему покупателя;
 * - желаемый результат.
 *
 * Проверенные серверные факты через этот
 * LLM tool не принимаем.
 */
export const requestOperatorHandoffTool = tool(
  async ({ reason, issue, userGoal }) => {
    const trigger =
      reason === 'CUSTOMER_REQUEST'
        ? 'EXPLICIT_USER_REQUEST'
        : 'UNSUPPORTED_INTENT';

    const handoffRequest = HandoffRequestSchema.parse({
      reason,
      trigger,

      evidence: {
        source: 'customerHelpAgent',

        userReportedIssue: issue?.trim() || null,

        requestedOutcome: userGoal?.trim() || null,

        /*
         * Эти поля заполняются только
         * проверенными данными backend.
         *
         * Не даём модели самостоятельно
         * объявлять факты подтверждёнными.
         */
        verifiedFacts: [],

        actionsTaken: [],

        unresolvedQuestions: [],

        relatedEntities: null,
      },
    });

    return new Command({
      goto: 'handoffAgent',

      graph: Command.PARENT,

      update: {
        handoffRequest,
      },
    });
  },
  {
    name: 'request_operator_handoff',

    description: [
      'Передай разговор человеку-оператору.',
      'Используй инструмент только если покупатель',
      'прямо просит человека или требуется действие',
      'реального сотрудника, которое система',
      'не может выполнить автоматически.',
      'Не используй инструмент при обычном',
      'недостатке информации в базе знаний.',
      'Не вызывай оператора только из-за',
      'неудачного поиска ответа.',
    ].join(' '),

    schema: z.object({
      reason: z
        .enum(['CUSTOMER_REQUEST', 'UNSUPPORTED_ACTION'])
        .describe(
          [
            'CUSTOMER_REQUEST — покупатель прямо попросил человека.',
            'UNSUPPORTED_ACTION — требуется действие сотрудника,',
            'которое нельзя выполнить автоматически.',
          ].join(' '),
        ),

      issue: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .nullable()
        .optional()
        .describe('Кратко опиши обращение покупателя. Не придумывай факты.'),

      userGoal: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .nullable()
        .optional()
        .describe(
          'Какого результата хочет покупатель. Если неизвестно — null.',
        ),
    }),
  },
);
