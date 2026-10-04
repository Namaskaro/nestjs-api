import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';

import { createAgent } from 'langchain';

import { AiService } from '@/src/ai/ai.service';

import type { ProductConsultationLlmContext } from '@/src/product-consultation/application/context/product-consultation-context';

import {
  ProductConsultantDecisionSchema,
  type ProductConsultantDecision,
} from '@/src/product-consultation/application/consultant/product-consultant-decision.schema';

import type { ProductConsultantRoundObservation } from '@/src/product-consultation/application/consultant/product-consultant-model.port';

import { ConsultationCore } from '@/src/product-consultation/core/consultation-core';

import type { AgentComparisonView } from '@/src/product-consultation/core/consultation-core.schema';

import {
  consultationAgentPrompt,
  consultationCompletionPrompt,
} from './prompts/consultation-agent.prompt';

import {
  productConsultantDecisionPrompt,
  productConsultantResponsePrompt,
} from './prompts/product-consultant.prompt';

import {
  ConsultationAgentInputSchema,
  type ConsultationAgentInput,
} from './schemas/consultation-agent.schema';

import { ConsultationCompletionOutputSchema } from './schemas/consultation-completion.schema';

import { createConsultationCoreTools } from './tools/consultation-core.tools';

import { finalizeConsultation } from './consultation-finalizer';
import { ProductWorkspacePlanSchema } from '../workspace/product-workspace-plan';
import { productWorkspacePrompt } from '../workspace/product-workspace.prompt';

export type ProductConsultantAgentInput = {
  context: ProductConsultationLlmContext;

  observation: ProductConsultantRoundObservation;

  signal?: AbortSignal;
};

export type ProductConsultantResponse = {
  terminalText: string;
};

export function createConsultationAgent(aiService: AiService) {
  const model = aiService.getChatModel('yandex');

  const decisionModel = model
    .withStructuredOutput(ProductConsultantDecisionSchema, {
      name: 'product_consultant_decision',
      method: 'functionCalling',
      strict: false,
    })
    .withRetry({
      stopAfterAttempt: 2,
    });

  const completionModel = model.withStructuredOutput(
    ConsultationCompletionOutputSchema,
    {
      name: 'finalize_consultation',
      method: 'functionCalling',
      strict: false,
      includeRaw: true,
    },
  );

  return {
    async decideWorkspace(context: unknown) {
      const result = await model
        .withStructuredOutput(ProductWorkspacePlanSchema, {
          name: 'product_workspace_decision',
          method: 'functionCalling',
          strict: false,
        })
        .withRetry({ stopAfterAttempt: 2 })
        .invoke([
          new SystemMessage(productWorkspacePrompt),
          new HumanMessage(JSON.stringify(context)),
        ]);
      return ProductWorkspacePlanSchema.parse(result);
    },

    async decide(
      input: ProductConsultantAgentInput,
    ): Promise<ProductConsultantDecision> {
      const decision = await decisionModel.invoke(
        [
          new SystemMessage(productConsultantDecisionPrompt),

          new HumanMessage(
            JSON.stringify({
              observation: input.observation,
              context: input.context,
            }),
          ),
        ],
        {
          signal: input.signal,
        },
      );

      return ProductConsultantDecisionSchema.parse(decision);
    },

    async respond(
      input: ProductConsultantAgentInput,
    ): Promise<ProductConsultantResponse> {
      const response = await model.invoke(
        [
          new SystemMessage(productConsultantResponsePrompt),

          new HumanMessage(
            JSON.stringify({
              observation: input.observation,
              context: input.context,
            }),
          ),
        ],
        {
          signal: input.signal,
        },
      );

      const terminalText = response.text.trim();

      if (!terminalText) {
        throw new Error(
          'ConsultationAgent: response model вернула пустой ответ',
        );
      }

      return {
        terminalText,
      };
    },

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
