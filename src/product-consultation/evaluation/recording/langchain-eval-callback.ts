import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

import { extractLlmUsage } from '@/src/ai/llm-usage';

import type { EvaluationJsonValue } from '../contracts/evaluation-scenario';

import type { EvaluationTokenUsage } from '../contracts/evaluation-observation';

import { EvaluationRecorder } from './evaluation-recorder';

type UnknownRecord = Record<string, unknown>;

type ActiveLlmRun = {
  name: string;

  startedAtMs: number;
};

type ActiveToolRun = {
  name: string;

  args: EvaluationJsonValue;

  startedAtMs: number;
};

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSerializedName(serialized: unknown, fallback: string): string {
  const record = asRecord(serialized);

  if (typeof record?.name === 'string' && record.name.trim()) {
    return record.name;
  }

  const id = record?.id;

  if (Array.isArray(id)) {
    const last = id.at(-1);

    if (typeof last === 'string' && last.trim()) {
      return last;
    }
  }

  return fallback;
}

function toEvaluationJsonValue(value: unknown): EvaluationJsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  switch (typeof value) {
    case 'string':
      return value;

    case 'number':
      return value;

    case 'boolean':
      return value;
  }

  try {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      return null;
    }

    return JSON.parse(serialized) as EvaluationJsonValue;
  } catch {
    return String(value);
  }
}

function hasUsage(usage: ReturnType<typeof extractLlmUsage>): boolean {
  return (
    usage.inputTokens !== null ||
    usage.outputTokens !== null ||
    usage.totalTokens !== null ||
    usage.cachedInputTokens !== null
  );
}

function extractCallbackUsage(
  output: unknown,
): ReturnType<typeof extractLlmUsage> {
  const direct = extractLlmUsage(output);

  if (hasUsage(direct)) {
    return direct;
  }

  const record = asRecord(output);

  if (!record) {
    return direct;
  }

  const candidates: unknown[] = [record.llmOutput];

  if (Array.isArray(record.generations)) {
    for (const generationGroup of record.generations) {
      if (!Array.isArray(generationGroup)) {
        continue;
      }

      for (const generation of generationGroup) {
        const generationRecord = asRecord(generation);

        candidates.push(
          generation,

          generationRecord?.message,

          generationRecord?.generationInfo,
        );
      }
    }
  }

  for (const candidate of candidates) {
    const usage = extractLlmUsage(candidate);

    if (hasUsage(usage)) {
      return usage;
    }
  }

  return direct;
}

function toEvaluationUsage(
  usage: ReturnType<typeof extractLlmUsage>,
): EvaluationTokenUsage {
  return {
    inputTokens: usage.inputTokens,

    outputTokens: usage.outputTokens,

    totalTokens: usage.totalTokens,

    cachedInputTokens: usage.cachedInputTokens,

    usageMissing:
      usage.inputTokens === null &&
      usage.outputTokens === null &&
      usage.totalTokens === null,
  };
}

function summarizeToolResult(value: unknown): EvaluationJsonValue {
  if (typeof value === 'string') {
    return {
      type: 'string',

      length: value.length,
    };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',

      length: value.length,
    };
  }

  if (value !== null && typeof value === 'object') {
    return {
      type: 'object',
    };
  }

  return {
    type: value === null ? 'null' : typeof value,
  };
}

export function createLangChainEvalCallback(
  recorder: EvaluationRecorder,
): BaseCallbackHandler {
  const llmRuns = new Map<string, ActiveLlmRun>();

  const toolRuns = new Map<string, ActiveToolRun>();

  const startLlm = (serialized: unknown, runId: string) => {
    llmRuns.set(runId, {
      name: getSerializedName(serialized, 'llm'),

      startedAtMs: Date.now(),
    });
  };

  return BaseCallbackHandler.fromMethods({
    handleLLMStart(serialized, _prompts, runId) {
      startLlm(serialized, runId);
    },

    handleChatModelStart(serialized, _messages, runId) {
      startLlm(serialized, runId);
    },

    handleLLMEnd(output, runId) {
      const active = llmRuns.get(runId);

      const usage = extractCallbackUsage(output);

      recorder.recordLlmCall({
        callId: runId,

        name: active?.name ?? 'llm',

        provider: null,

        model: usage.model,

        durationMs: active ? Math.max(0, Date.now() - active.startedAtMs) : 0,

        usage: toEvaluationUsage(usage),

        error: null,
      });

      llmRuns.delete(runId);
    },

    handleLLMError(error, runId) {
      const active = llmRuns.get(runId);

      const message = errorMessage(error);

      recorder.recordLlmCall({
        callId: runId,

        name: active?.name ?? 'llm',

        provider: null,

        model: null,

        durationMs: active ? Math.max(0, Date.now() - active.startedAtMs) : 0,

        usage: {
          inputTokens: null,

          outputTokens: null,

          totalTokens: null,

          cachedInputTokens: null,

          usageMissing: true,
        },

        error: message,
      });

      recorder.recordError({
        source: `llm:${active?.name ?? 'unknown'}`,

        message,

        code: null,
      });

      llmRuns.delete(runId);
    },

    handleToolStart(serialized, input, runId) {
      toolRuns.set(runId, {
        name: getSerializedName(serialized, 'tool'),

        args: toEvaluationJsonValue(input),

        startedAtMs: Date.now(),
      });
    },

    handleToolEnd(output, runId) {
      const active = toolRuns.get(runId);

      recorder.recordToolCall({
        callId: runId,

        name: active?.name ?? 'tool',

        args: active?.args ?? null,

        resultMetadata: summarizeToolResult(output),

        durationMs: active ? Math.max(0, Date.now() - active.startedAtMs) : 0,

        error: null,
      });

      toolRuns.delete(runId);
    },

    handleToolError(error, runId) {
      const active = toolRuns.get(runId);

      const message = errorMessage(error);

      recorder.recordToolCall({
        callId: runId,

        name: active?.name ?? 'tool',

        args: active?.args ?? null,

        resultMetadata: null,

        durationMs: active ? Math.max(0, Date.now() - active.startedAtMs) : 0,

        error: message,
      });

      recorder.recordError({
        source: `tool:${active?.name ?? 'unknown'}`,

        message,

        code: null,
      });

      toolRuns.delete(runId);
    },
  });
}
