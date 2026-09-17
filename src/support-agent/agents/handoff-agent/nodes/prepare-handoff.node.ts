import type { GraphNode } from '@langchain/langgraph';

import { AiService } from '@/src/ai/ai.service';

import { handoffHistoryTrimmer } from '@/src/support-agent/context/history-context';

import { HandoffState } from '../handoff-agent.state';

import { prepareHandoffPrompt } from '../prompts/prepare-handoff.prompt';

import { HandoffContextSchema } from '../schemas/handoff.schema';

export function createPrepareHandoffNode(
  aiService: AiService,
): GraphNode<typeof HandoffState> {
  const model = aiService.getChatModel('yandex');

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

    // START ИЗМЕНЕНИЙ — RESTORE REAL HANDOFF NODE + TRIMMING
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
    // END ИЗМЕНЕНИЙ

    const context = await chain.invoke({
      reason: state.handoffRequest.reason,

      trigger: state.handoffRequest.trigger,

      conversation,
    });

    return {
      preparedContext: context,

      preparationStatus: 'READY',
    };
  };
}
