import { describe, expect, it } from '@jest/globals';

import { EvaluationRecorder } from './evaluation-recorder';

describe('EvaluationRecorder', () => {
  it('records one complete evaluation turn', () => {
    const timestamps = [
      new Date('2026-09-23T10:00:00.000Z'),
      new Date('2026-09-23T10:00:01.000Z'),
      new Date('2026-09-23T10:00:03.000Z'),
      new Date('2026-09-23T10:00:04.000Z'),
    ];

    let clockIndex = 0;

    const recorder = new EvaluationRecorder({
      scenarioId: 'E01',

      target: 'product_consultation',

      initialState: {
        step: 'initial',
      },

      clock: () => {
        const value = timestamps[clockIndex];

        clockIndex += 1;

        if (!value) {
          throw new Error('Test clock exhausted');
        }

        return value;
      },
    });

    recorder.beginTurn(
      {
        id: 'T1',

        kind: 'message',

        message: 'Test message',

        messageId: null,
      },
      {
        step: 'initial',
      },
    );

    recorder.recordLlmCall({
      callId: 'llm-1',

      name: 'test_llm',

      provider: 'test',

      model: 'test-model',

      durationMs: 100,

      usage: {
        inputTokens: 10,

        outputTokens: 5,

        totalTokens: 15,

        cachedInputTokens: 0,

        usageMissing: false,
      },

      error: null,
    });

    recorder.recordToolCall({
      callId: 'tool-1',

      name: 'search_products',

      args: {
        query: 'test',
      },

      resultMetadata: {
        count: 2,
      },

      durationMs: 50,

      error: null,
    });

    recorder.recordArtifact({
      id: 'artifact-1',

      kind: 'search_results',

      data: {
        count: 2,
      },
    });

    recorder.finishTurn({
      stateAfter: {
        step: 'finished',
      },

      outcome: 'answer',

      finalText: 'Done',

      resultMetadata: {
        ok: true,
      },
    });

    const observation = recorder.finish({
      step: 'finished',
    });

    expect(observation.scenarioId).toBe('E01');

    expect(observation.target).toBe('product_consultation');

    expect(observation.durationMs).toBe(4000);

    expect(observation.turns).toHaveLength(1);

    const turn = observation.turns[0];

    expect(turn.durationMs).toBe(2000);

    expect(turn.outcome).toBe('answer');

    expect(turn.finalText).toBe('Done');

    expect(turn.llmCalls).toHaveLength(1);

    expect(turn.toolCalls).toHaveLength(1);

    expect(turn.toolCalls[0]?.name).toBe('search_products');

    expect(turn.artifacts).toHaveLength(1);

    expect(observation.finalState).toEqual({
      step: 'finished',
    });
  });

  it('does not allow two active turns', () => {
    const recorder = new EvaluationRecorder({
      scenarioId: 'E01',

      target: 'product_consultation',

      initialState: null,
    });

    recorder.beginTurn(
      {
        id: 'T1',

        kind: 'message',

        message: 'First',

        messageId: null,
      },
      null,
    );

    expect(() =>
      recorder.beginTurn(
        {
          id: 'T2',

          kind: 'message',

          message: 'Second',

          messageId: null,
        },
        null,
      ),
    ).toThrow('ещё не завершён');
  });

  it('does not finish an empty scenario', () => {
    const recorder = new EvaluationRecorder({
      scenarioId: 'E01',

      target: 'product_consultation',

      initialState: null,
    });

    expect(() => recorder.finish(null)).toThrow(
      'scenario не содержит завершённых turns',
    );
  });
});
