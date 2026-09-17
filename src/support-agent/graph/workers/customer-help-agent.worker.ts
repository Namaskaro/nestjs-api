import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { AIMessage } from '@langchain/core/messages';

import {
  Command,
  END,
  type GraphNode,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';

import { CustomerHelpAgent } from '../../agents/customer-help-agent/customer-help.agent';

import {
  CustomerHelpAnswerBlockSchema,
  CustomerHelpFinalAnswerSchema,
} from '../../schemas/support-agent-answer.schema';

import { SupportAgentState } from '../support-agent.state';

export function createCustomerHelpAgentWorker(
  customerHelpAgent: CustomerHelpAgent,
): GraphNode<typeof SupportAgentState> {
  return async (state, config: LangGraphRunnableConfig) => {
    await dispatchCustomEvent(
      'assistant_status',
      {
        status: 'SEARCHING_FAQ',
      },
      config,
    );

    const agentResult = await customerHelpAgent.invoke(
      {
        messages: state.messages,
      },
      config,
    );

    const finalMessage = agentResult.messages.at(-1);

    if (!AIMessage.isInstance(finalMessage)) {
      throw new Error(
        'CustomerHelpAgentWorker: отсутствует финальный AIMessage',
      );
    }

    const message = finalMessage.text;

    if (state.executionMode === 'multi') {
      const workerResult = CustomerHelpAnswerBlockSchema.parse({
        worker: 'customer_help',

        data: {
          message,
        },
      });

      return new Command({
        goto: 'aggregateAnswer',

        update: {
          workerResults: [workerResult],
        },
      });
    }

    const answer = CustomerHelpFinalAnswerSchema.parse({
      type: 'customer_help',

      message,
    });

    return new Command({
      goto: END,

      update: {
        answer,
        activeAgent: 'customerHelpAgent',
        messages: [new AIMessage(answer.message)],
      },
    });
  };
}
