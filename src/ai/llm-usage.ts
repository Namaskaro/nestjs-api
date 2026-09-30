import { Logger } from '@nestjs/common';

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

type UnknownRecord = Record<string, unknown>;

export type LlmUsageSnapshot = {
  inputTokens: number | null;

  outputTokens: number | null;

  totalTokens: number | null;

  cachedInputTokens: number | null;

  model: string | null;
};

export type AggregatedLlmUsageSnapshot = LlmUsageSnapshot & {
  requestsWithUsage: number;
};

type ActiveLlmRun = {
  startedAt: number;

  runName: string | null;

  tags: readonly string[];

  metadata: Record<string, unknown>;

  model: string | null;
};

const logger = new Logger('LlmUsage');

const activeRuns = new Map<string, ActiveLlmRun>();

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

function extractGenerationMessages(output: unknown): UnknownRecord[] {
  const record = asRecord(output);

  return asArray(record?.generations)
    .flatMap((generationGroup) => asArray(generationGroup))
    .flatMap((generation) => {
      const record = asRecord(generation);

      const message = asRecord(record?.message);

      return message === null ? [] : [message];
    });
}

/**
 * Поддерживает как обычный
 * AIMessage / structured wrapper,
 * так и LLMResult из LangChain callback.
 */
export function extractLlmUsage(response: unknown): LlmUsageSnapshot {
  const wrapper = asRecord(response);

  const raw = asRecord(wrapper?.raw) ?? wrapper;

  const messages = extractGenerationMessages(response);

  const messageUsage =
    messages
      .map((message) => asRecord(message.usage_metadata))
      .find((value): value is UnknownRecord => value !== null) ?? null;

  const messageResponseMetadata =
    messages
      .map((message) => asRecord(message.response_metadata))
      .find((value): value is UnknownRecord => value !== null) ?? null;

  const usageMetadata = asRecord(raw?.usage_metadata) ?? messageUsage;

  const responseMetadata =
    asRecord(raw?.response_metadata) ?? messageResponseMetadata;

  const llmOutput = asRecord(wrapper?.llmOutput);

  const tokenUsage =
    asRecord(responseMetadata?.tokenUsage) ?? asRecord(llmOutput?.tokenUsage);

  const responseUsage =
    asRecord(responseMetadata?.usage) ?? asRecord(llmOutput?.usage);

  const inputTokenDetails = asRecord(usageMetadata?.input_token_details);

  const promptTokenDetails = asRecord(responseUsage?.prompt_tokens_details);

  const inputTokens = firstNumber(
    usageMetadata?.input_tokens,

    tokenUsage?.promptTokens,

    tokenUsage?.inputTokens,

    responseUsage?.prompt_tokens,

    responseUsage?.input_tokens,
  );

  const outputTokens = firstNumber(
    usageMetadata?.output_tokens,

    tokenUsage?.completionTokens,

    tokenUsage?.outputTokens,

    responseUsage?.completion_tokens,

    responseUsage?.output_tokens,
  );

  const reportedTotalTokens = firstNumber(
    usageMetadata?.total_tokens,

    tokenUsage?.totalTokens,

    responseUsage?.total_tokens,
  );

  const totalTokens =
    reportedTotalTokens ??
    (inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null);

  const cachedInputTokens = firstNumber(
    inputTokenDetails?.cache_read,

    inputTokenDetails?.cached_tokens,

    tokenUsage?.cachedTokens,

    promptTokenDetails?.cached_tokens,
  );

  const model = firstString(
    responseMetadata?.model_name,

    responseMetadata?.model,

    llmOutput?.model,

    raw?.model,
  );

  return {
    inputTokens,

    outputTokens,

    totalTokens,

    cachedInputTokens,

    model,
  };
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);

  if (known.length === 0) {
    return null;
  }

  return known.reduce(
    (sum, value) => sum + value,

    0,
  );
}

export function aggregateLlmUsage(
  responses: readonly unknown[],
): AggregatedLlmUsageSnapshot {
  const usages = responses.map(extractLlmUsage);

  const models = [
    ...new Set(
      usages
        .map((usage) => usage.model)
        .filter((model): model is string => model !== null),
    ),
  ];

  const requestsWithUsage = usages.filter(
    (usage) =>
      usage.inputTokens !== null ||
      usage.outputTokens !== null ||
      usage.totalTokens !== null,
  ).length;

  return {
    inputTokens: sumKnown(usages.map((usage) => usage.inputTokens)),

    outputTokens: sumKnown(usages.map((usage) => usage.outputTokens)),

    totalTokens: sumKnown(usages.map((usage) => usage.totalTokens)),

    cachedInputTokens: sumKnown(usages.map((usage) => usage.cachedInputTokens)),

    model:
      models.length === 1 ? models[0]! : models.length > 1 ? 'mixed' : null,

    requestsWithUsage,
  };
}

export const llmUsageCallback: BaseCallbackHandler =
  BaseCallbackHandler.fromMethods({
    handleChatModelStart(
      llm,
      _messages,
      runId,
      _parentRunId,
      _extraParams,
      tags = [],
      metadata = {},
      runName,
    ) {
      const serialized = asRecord(llm);

      const kwargs = asRecord(serialized?.kwargs);

      activeRuns.set(runId, {
        startedAt: Date.now(),

        runName: runName ?? null,

        tags: [...tags],

        metadata: {
          ...metadata,
        },

        model: firstString(
          kwargs?.model,

          kwargs?.modelName,

          serialized?.name,
        ),
      });
    },

    handleLLMEnd(output, runId, parentRunId) {
      const active = activeRuns.get(runId);

      activeRuns.delete(runId);

      const usage = extractLlmUsage(output);

      logger.log(
        JSON.stringify({
          event: 'llm_call',

          status: 'success',

          runId,

          parentRunId: parentRunId ?? null,

          runName: active?.runName ?? null,

          durationMs:
            active === undefined ? null : Date.now() - active.startedAt,

          ...usage,

          model: usage.model ?? active?.model ?? null,

          tags: active?.tags ?? [],

          metadata: active?.metadata ?? {},
        }),
      );
    },

    handleLLMError(error, runId, parentRunId) {
      const active = activeRuns.get(runId);

      activeRuns.delete(runId);

      logger.warn(
        JSON.stringify({
          event: 'llm_call',

          status: 'error',

          runId,

          parentRunId: parentRunId ?? null,

          runName: active?.runName ?? null,

          durationMs:
            active === undefined ? null : Date.now() - active.startedAt,

          model: active?.model ?? null,

          tags: active?.tags ?? [],

          metadata: active?.metadata ?? {},

          error:
            error instanceof Error
              ? {
                  name: error.name,

                  message: error.message,
                }
              : {
                  message: String(error),
                },
        }),
      );
    },
  });

/**
 * LEGACY COMPATIBILITY.
 *
 * Старые Agent/Node файлы
 * пока импортируют эти функции.
 *
 * Они больше ничего не логируют:
 * physical telemetry уже собирает
 * llmUsageCallback.
 *
 * Удалим эти функции,
 * когда дочистим legacy call sites.
 */
export function logLlmUsage({
  response,
}: {
  node: string;

  response: unknown;

  durationMs: number;

  attributes?: Record<string, unknown>;
}): LlmUsageSnapshot {
  return extractLlmUsage(response);
}

export function logAggregatedLlmUsage({
  responses,
}: {
  node: string;

  responses: readonly unknown[];

  durationMs: number;

  attributes?: Record<string, unknown>;
}): AggregatedLlmUsageSnapshot {
  return aggregateLlmUsage(responses);
}
