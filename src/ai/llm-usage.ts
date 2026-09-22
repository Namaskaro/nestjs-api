import { Logger } from '@nestjs/common';

type UnknownRecord = Record<string, unknown>;

export type LlmUsageSnapshot = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  model: string | null;
};

type LogLlmUsageInput = {
  node: string;
  response: unknown;
  durationMs: number;
  attributes?: Record<string, unknown>;
};

const logger = new Logger('LlmUsage');

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : null;
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

export function extractLlmUsage(response: unknown): LlmUsageSnapshot {
  const wrapper = asRecord(response);

  const raw = asRecord(wrapper?.raw) ?? wrapper;

  const usageMetadata = asRecord(raw?.usage_metadata);

  const responseMetadata = asRecord(raw?.response_metadata);

  const tokenUsage = asRecord(responseMetadata?.tokenUsage);

  const responseUsage = asRecord(responseMetadata?.usage);

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

export type AggregatedLlmUsageSnapshot = LlmUsageSnapshot & {
  requestsWithUsage: number;
};

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);

  if (known.length === 0) {
    return null;
  }

  return known.reduce((sum, value) => sum + value, 0);
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

    model: models.length === 1 ? models[0] : models.length > 1 ? 'mixed' : null,

    requestsWithUsage,
  };
}

export function logLlmUsage({
  node,
  response,
  durationMs,
  attributes = {},
}: LogLlmUsageInput): LlmUsageSnapshot {
  const usage = extractLlmUsage(response);

  logger.log(
    JSON.stringify({
      event: 'llm_usage',
      node,
      durationMs,
      ...usage,
      ...attributes,
    }),
  );

  return usage;
}

export function logAggregatedLlmUsage({
  node,
  responses,
  durationMs,
  attributes = {},
}: {
  node: string;
  responses: readonly unknown[];
  durationMs: number;
  attributes?: Record<string, unknown>;
}): AggregatedLlmUsageSnapshot {
  const usage = aggregateLlmUsage(responses);

  logger.log(
    JSON.stringify({
      event: 'llm_usage',
      node,
      durationMs,
      ...usage,
      ...attributes,
    }),
  );

  return usage;
}
