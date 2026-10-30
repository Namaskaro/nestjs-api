import { describe, expect, it } from '@jest/globals';

import { aggregateLlmUsage, extractLlmUsage } from './llm-usage';

describe('extractLlmUsage', () => {
  it('reads LangChain usage_metadata', () => {
    const result = extractLlmUsage({
      usage_metadata: {
        input_tokens: 1200,
        output_tokens: 150,
        total_tokens: 1350,
        input_token_details: {
          cache_read: 200,
        },
      },
      response_metadata: {
        model_name: 'yandex-test-model',
      },
    });

    expect(result).toEqual({
      inputTokens: 1200,
      outputTokens: 150,
      totalTokens: 1350,
      cachedInputTokens: 200,
      model: 'yandex-test-model',
    });
  });

  it('reads OpenAI-compatible response_metadata tokenUsage', () => {
    const result = extractLlmUsage({
      response_metadata: {
        tokenUsage: {
          promptTokens: 800,
          completionTokens: 100,
          totalTokens: 900,
          cachedTokens: 50,
        },
        model: 'test-model',
      },
    });

    expect(result).toEqual({
      inputTokens: 800,
      outputTokens: 100,
      totalTokens: 900,
      cachedInputTokens: 50,
      model: 'test-model',
    });
  });

  it('reads usage from structured-output raw response', () => {
    const result = extractLlmUsage({
      parsed: {
        action: 'SEARCH',
      },

      raw: {
        usage_metadata: {
          input_tokens: 2000,
          output_tokens: 250,
          total_tokens: 2250,
        },

        response_metadata: {
          model_name: 'planner-model',
        },
      },
    });

    expect(result).toEqual({
      inputTokens: 2000,
      outputTokens: 250,
      totalTokens: 2250,
      cachedInputTokens: null,
      model: 'planner-model',
    });
  });

  it('calculates total when provider does not return total_tokens', () => {
    const result = extractLlmUsage({
      usage_metadata: {
        input_tokens: 500,
        output_tokens: 75,
      },
    });

    expect(result.totalTokens).toBe(575);
  });

  it('returns null values when provider returns no usage', () => {
    const result = extractLlmUsage({
      parsed: {
        action: 'SEARCH',
      },
    });

    expect(result).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      model: null,
    });
  });
  it('aggregates usage from multiple model responses', () => {
    const result = aggregateLlmUsage([
      {
        usage_metadata: {
          input_tokens: 1000,
          output_tokens: 100,
          total_tokens: 1100,
        },

        response_metadata: {
          model_name: 'consult-model',
        },
      },

      {
        usage_metadata: {
          input_tokens: 1500,
          output_tokens: 200,
          total_tokens: 1700,
        },

        response_metadata: {
          model_name: 'consult-model',
        },
      },

      {
        type: 'tool',
        content: 'not an LLM response',
      },
    ]);

    expect(result).toEqual({
      inputTokens: 2500,
      outputTokens: 300,
      totalTokens: 2800,
      cachedInputTokens: null,
      model: 'consult-model',
      requestsWithUsage: 2,
    });
  });

  it('returns null token totals when no response contains usage', () => {
    const result = aggregateLlmUsage([
      {
        type: 'human',
        content: 'hello',
      },

      {
        type: 'tool',
        content: 'result',
      },
    ]);

    expect(result).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      model: null,
      requestsWithUsage: 0,
    });
  });
});
