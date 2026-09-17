import { tool } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';

import { HandoffRequestSchema } from '../../handoff-agent/schemas/handoff.schema';

export const requestOperatorHandoffTool = tool(
  async ({ reason }) => {
    const trigger =
      reason === 'CUSTOMER_REQUEST'
        ? 'EXPLICIT_USER_REQUEST'
        : 'UNSUPPORTED_INTENT';

    const handoffRequest = HandoffRequestSchema.parse({
      reason,
      trigger,
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

    description:
      'Передай разговор человеку-оператору, если пользователь прямо просит оператора или если для решения запроса требуется действие реального сотрудника.',

    schema: z.object({
      reason: z
        .enum(['CUSTOMER_REQUEST', 'UNSUPPORTED_ACTION'])
        .describe(
          [
            'CUSTOMER_REQUEST — пользователь сам прямо попросил оператора, сотрудника или человека.',
            'UNSUPPORTED_ACTION — пользователь просит выполнить действие, которое должен выполнить реальный сотрудник.',
          ].join(' '),
        ),
    }),
  },
);
