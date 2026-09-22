import { describe, expect, it } from '@jest/globals';

import {
  createEvaluationCapabilityProxy,
  type EvaluationToolCallSink,
} from './evaluation-capability-proxy';

import type { EvaluationToolCall } from '../contracts/evaluation-observation';

class TestService {
  async search(query: string): Promise<string[]> {
    return [`${query}-1`, `${query}-2`];
  }

  async fail(): Promise<void> {
    throw new Error('Test failure');
  }

  helper(value: string): string {
    return value.toUpperCase();
  }
}

describe('createEvaluationCapabilityProxy', () => {
  it('records configured capability calls', async () => {
    const calls: EvaluationToolCall[] = [];

    const sink: EvaluationToolCallSink = {
      recordToolCall(call) {
        calls.push(call);
      },
    };

    const service = createEvaluationCapabilityProxy({
      target: new TestService(),

      getSink: () => sink,

      definitions: [
        {
          method: 'search',

          name: 'search_products',

          mapArgs: (args) => ({
            query: String(args[0]),
          }),

          mapResult: (result) => ({
            count: Array.isArray(result) ? result.length : 0,
          }),
        },
      ],
    });

    const result = await service.search('nike');

    expect(result).toEqual(['nike-1', 'nike-2']);

    expect(calls).toHaveLength(1);

    expect(calls[0]?.name).toBe('search_products');

    expect(calls[0]?.args).toEqual({
      query: 'nike',
    });

    expect(calls[0]?.resultMetadata).toEqual({
      count: 2,
    });

    expect(calls[0]?.error).toBeNull();
  });

  it('does not record methods that are not configured capabilities', () => {
    const calls: EvaluationToolCall[] = [];

    const sink: EvaluationToolCallSink = {
      recordToolCall(call) {
        calls.push(call);
      },
    };

    const service = createEvaluationCapabilityProxy({
      target: new TestService(),

      getSink: () => sink,

      definitions: [
        {
          method: 'search',

          name: 'search_products',
        },
      ],
    });

    const result = service.helper('test');

    expect(result).toBe('TEST');

    expect(calls).toHaveLength(0);
  });

  it('records failed capability calls and rethrows the error', async () => {
    const calls: EvaluationToolCall[] = [];

    const sink: EvaluationToolCallSink = {
      recordToolCall(call) {
        calls.push(call);
      },
    };

    const service = createEvaluationCapabilityProxy({
      target: new TestService(),

      getSink: () => sink,

      definitions: [
        {
          method: 'fail',

          name: 'test_failure',
        },
      ],
    });

    await expect(service.fail()).rejects.toThrow('Test failure');

    expect(calls).toHaveLength(1);

    expect(calls[0]?.name).toBe('test_failure');

    expect(calls[0]?.error).toBe('Test failure');
  });
});
