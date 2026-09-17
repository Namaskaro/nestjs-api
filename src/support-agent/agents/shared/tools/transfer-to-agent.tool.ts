import { tool } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';

import {
  RequestRouterWorkerSchema,
  type RequestRouterWorker,
} from '../../../schemas/request-router.schema';

export function createTransferToAgentTool(currentAgent: RequestRouterWorker) {
  return tool(
    async ({ targetAgent }) => {
      if (targetAgent === currentAgent) {
        throw new Error(
          `TransferToAgentTool: ${currentAgent} не может передать управление самому себе`,
        );
      }

      return new Command({
        goto: targetAgent,

        graph: Command.PARENT,
      });
    },
    {
      name: 'transfer_to_agent',

      description:
        'Передай дальнейшее ведение разговора другому специализированному агенту, если текущий вопрос относится к его области ответственности.',

      schema: z.object({
        targetAgent: RequestRouterWorkerSchema.describe(
          'Другой специализированный агент, которому нужно передать разговор.',
        ),
      }),
    },
  );
}
