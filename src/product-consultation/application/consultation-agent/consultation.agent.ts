import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createAgent } from 'langchain';
import { AiService } from '../../../../../ai/ai.service';
import { ConsultationCore } from '../../../../../product-consultation/core/consultation-core';
import type { AgentComparisonView } from '../../consultation-core/consultation-core.schema';
import {
  consultationAgentPrompt,
  consultationCompletionPrompt,
} from './prompts/consultation-agent.prompt';
import {
  ConsultationAgentInputSchema,
  type ConsultationAgentInput,
} from './schemas/consultation-agent.schema';
import { createConsultationCoreTools } from './tools/consultation-core.tools';
import { ConsultationCompletionOutputSchema } from './schemas/consultation-completion.schema';
import { finalizeConsultation } from './consultation-finalizer';

export function createConsultationAgent(aiService: AiService) {
  const model = aiService.getChatModel('yandex');

  const completionModel = model.withStructuredOutput(
    ConsultationCompletionOutputSchema,
    {
      name: 'finalize_consultation',

      includeRaw: true,
    },
  );

  return {
    async invoke(
      rawInput: ConsultationAgentInput,

      core: ConsultationCore,

      comparisons?: AgentComparisonView[],
    ) {
      const input = ConsultationAgentInputSchema.parse(rawInput);

      let messages: BaseMessage[] = [new HumanMessage(JSON.stringify(input))];

      if (comparisons !== undefined) {
        messages.push(
          new HumanMessage(
            JSON.stringify({
              preparedComparisons: comparisons,
            }),
          ),
        );
      } else {
        const tools = createConsultationCoreTools(core, input.query);

        const agent = createAgent({
          model,

          systemPrompt: consultationAgentPrompt,

          tools: [
            tools.updateMemory,
            tools.getProductDetails,
            tools.compareProducts,
          ],

          checkpointer: false,
        });

        try {
          const run = await agent.invoke(
            {
              messages,
            },
            {
              recursionLimit: 24,
            },
          );

          messages = run.messages;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.name !== 'GraphRecursionError'
          ) {
            throw error;
          }

          return finalizeConsultation(input, null, core);
        }
      }

      const completion = await completionModel.invoke([
        new SystemMessage(consultationCompletionPrompt),

        ...messages,

        new HumanMessage('Сформируй итоговый результат консультации.'),
      ]);

      return finalizeConsultation(input, completion.parsed, core);
    },
  };
}

export type ConsultationAgent = ReturnType<typeof createConsultationAgent>;
