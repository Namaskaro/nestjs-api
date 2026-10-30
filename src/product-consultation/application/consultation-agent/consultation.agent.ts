import { Logger } from '@nestjs/common';
import { ZodError } from 'zod';

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

import { productConsultantDecisionPrompt } from './prompts/product-consultant.prompt';

import {
  ConsultationAgentInputSchema,
  type ConsultationAgentInput,
} from './schemas/consultation-agent.schema';

import { ConsultationCompletionOutputSchema } from './schemas/consultation-completion.schema';

import { createConsultationCoreTools } from './tools/consultation-core.tools';

import { finalizeConsultation } from './consultation-finalizer';

import {
  normalizeProductWorkspaceModelPlan,
  ProductWorkspaceModelPlanSchema,
} from '../workspace/product-workspace-model-plan';

import { productWorkspacePrompt } from '../workspace/product-workspace.prompt';

export type ProductConsultantAgentInput = {
  context: ProductConsultationLlmContext;
  observation: ProductConsultantRoundObservation;
  signal?: AbortSignal;
};

const workspaceLogger = new Logger('ProductWorkspacePlanner');

const WORKSPACE_REPAIR_PROMPT = `
Предыдущий structured output оказался пустым или невалидным.

Верни минимальный валидный Workspace plan.

Не копируй входные данные.
Не объясняй решение.
Не пиши обычный текст вместо structured output.
Не создавай decision.proposal.
Не создавай memoryObservations.
Используй только usageScenarioIds, которые есть во входном usageScenarios.
`.trim();

const WORKSPACE_PLAIN_JSON_PROMPT = `
Верни один JSON-объект без Markdown, пояснений и текста вокруг.

Форма ответа:
{
  "operations": [
    {
      "kind": "consult",
      "target": { "kind": "new" },
      "query": "текст относящегося к задаче запроса",
      "actions": [
        {
          "decision": {
            "action": "SEARCH",
            "search": {
              "semanticIntent": "запрос для поиска",
              "category": null,
              "constraints": []
            },
            "searchPatch": null,
            "selection": null,
            "feedback": null,
            "usageScenarioIds": [],
            "factAttributeIds": [],
            "terminalText": null
          },
          "view": null
        }
      ]
    }
  ],
  "clarification": null
}

Это только пример СТРУКТУРЫ, а не указание всегда выбирать SEARCH.
Выбирай правильные действия, target, selection, search и searchPatch
по основному промпту и входному контексту.

При неоднозначности без операций верни:
{"operations":[],"clarification":"конкретный уточняющий вопрос"}.

Для каждой независимой подборки создай отдельную operation.
Для последовательных действий одной подборки используй массив actions.
`.trim();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePlainWorkspaceJson(response: BaseMessage): unknown | null {
  const text = response.text.trim();

  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);

  try {
    const candidate: unknown = JSON.parse(fenced ? fenced[1] : text);

    return isRecord(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function workspaceFallbackQuery(context: unknown): string | null {
  if (!isRecord(context)) {
    return null;
  }

  const currentMessage = context.currentMessage;

  return typeof currentMessage === 'string' && currentMessage.trim()
    ? currentMessage.trim()
    : null;
}

function extractRawToolArguments(response: unknown): unknown | null {
  if (!isRecord(response)) {
    return null;
  }

  const raw = response.raw;

  if (!isRecord(raw)) {
    return null;
  }

  const directToolCalls = raw.tool_calls;

  if (Array.isArray(directToolCalls) && directToolCalls.length === 1) {
    const toolCall = directToolCalls[0];

    if (isRecord(toolCall)) {
      const args = toolCall.args;

      if (isRecord(args)) {
        return args;
      }
    }
  }

  const additionalKwargs = raw.additional_kwargs;

  if (!isRecord(additionalKwargs)) {
    return null;
  }

  const toolCalls = additionalKwargs.tool_calls;

  if (!Array.isArray(toolCalls) || toolCalls.length !== 1) {
    return null;
  }

  const toolCall = toolCalls[0];

  if (!isRecord(toolCall)) {
    return null;
  }

  const fn = toolCall.function;

  if (!isRecord(fn)) {
    return null;
  }

  const args = fn.arguments;

  if (isRecord(args)) {
    return args;
  }

  if (typeof args !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(args);

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractWorkspaceCandidate(response: unknown): unknown | null {
  if (!isRecord(response)) {
    return response ?? null;
  }

  if (!Object.prototype.hasOwnProperty.call(response, 'parsed')) {
    return response;
  }

  if (response.parsed !== null && response.parsed !== undefined) {
    return response.parsed;
  }

  return extractRawToolArguments(response);
}

function workspaceParsingError(response: unknown): unknown | null {
  if (!isRecord(response)) {
    return null;
  }

  return response.parsing_error ?? null;
}

export function createConsultationAgent(aiService: AiService) {
  const model = aiService.getChatModel('STANDARD');

  const decisionModel = model
    .withStructuredOutput(ProductConsultantDecisionSchema, {
      name: 'product_consultant_decision',
      method: 'functionCalling',
      strict: false,
    })
    .withRetry({
      stopAfterAttempt: 2,
    });

  /*
   * Yandex продолжает использовать существующий structured output.
   *
   * Для Qwen и GigaChat не отправляем сложную JSON Schema
   * на сервер провайдера при вызове Workspace Planner.
   *
   * Ответ остаётся JSON, но проверяется локально
   * существующим нормализатором и Zod.
   */
  const provider = model.metadata?.provider;

  const plainWorkspaceOutput =
    provider === 'qwen' ||
    provider === 'gigachat' ||
    model.tags?.includes('provider:qwen') === true ||
    model.tags?.includes('provider:gigachat') === true;

  workspaceLogger.log(
    `Workspace output mode: ${
      plainWorkspaceOutput ? 'plain-json' : 'structured'
    }`,
  );

  const workspaceDecisionModel = plainWorkspaceOutput
    ? null
    : model.withStructuredOutput(ProductWorkspaceModelPlanSchema, {
        name: 'product_workspace_decision',
        method: 'functionCalling',
        strict: false,
        includeRaw: true,
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
      const fallbackQuery = workspaceFallbackQuery(context);

      let repairDetails = '';

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const messages = [
            new SystemMessage(
              plainWorkspaceOutput
                ? `${productWorkspacePrompt}\n\n${WORKSPACE_PLAIN_JSON_PROMPT}`
                : productWorkspacePrompt,
            ),
            ...(attempt === 0
              ? []
              : [
                  new SystemMessage(
                    `${WORKSPACE_REPAIR_PROMPT}\n${repairDetails}`,
                  ),
                ]),
            new HumanMessage(JSON.stringify(context)),
          ];

          const response = plainWorkspaceOutput
            ? await model.invoke(messages)
            : await workspaceDecisionModel!.invoke(messages);

          const candidate = plainWorkspaceOutput
            ? parsePlainWorkspaceJson(response as BaseMessage)
            : extractWorkspaceCandidate(response);

          if (candidate === null) {
            if (!plainWorkspaceOutput) {
              const raw = isRecord(response) ? response.raw : null;

              if (
                isRecord(raw) &&
                isRecord(raw.additional_kwargs) &&
                raw.additional_kwargs.refusal
              ) {
                throw new Error(
                  'ProductWorkspacePlanner: model refused structured output.',
                );
              }
            }

            repairDetails =
              'Ответ должен быть полным JSON-объектом нужной структуры.';

            workspaceLogger.warn(
              `Workspace structured output is empty on attempt ${
                attempt + 1
              }. Parsing error: ${String(workspaceParsingError(response))}`,
            );

            continue;
          }

          try {
            return normalizeProductWorkspaceModelPlan(candidate, fallbackQuery);
          } catch (error) {
            // Исправлять повторным запросом можно только
            // ответ модели, отклонённый Zod.
            if (!(error instanceof ZodError) || attempt > 0) {
              throw error;
            }

            repairDetails = error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('\n')
              .slice(0, 1200);

            workspaceLogger.warn(
              `Workspace plan normalization failed on attempt ${attempt + 1}: ${
                error instanceof Error ? error.message : String(error)
              }. Candidate: ${JSON.stringify(candidate)}`,
            );

            continue;
          }
        } catch (error) {
          workspaceLogger.warn(
            `Workspace planner failed on attempt ${attempt + 1}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );

          // Ошибки транспорта не исправляются повторным вызовом.
          throw error;
        }
      }

      throw new Error(
        'ProductWorkspacePlanner: не удалось получить валидный workspace plan.',
      );
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
