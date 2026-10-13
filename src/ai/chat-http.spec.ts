import { assertCompletedChatResponse, createChatFetch } from './chat-http';
import { Logger } from '@nestjs/common';

describe('completion safety at the HTTP boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves an abort while the response body is being read', async () => {
    const error = new Error('Aborted while reading');
    error.name = 'AbortError';
    const response = new Response('{}');
    jest.spyOn(response, 'clone').mockReturnValue({
      json: jest.fn().mockRejectedValue(error),
    } as unknown as Response);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const http = createChatFetch({
      mode: 'direct',
      role: 'STANDARD',
      api: 'responses',
    });
    await expect(
      http('https://provider.invalid/v1/responses', { body: '{}' }),
    ).rejects.toBe(error);
    expect(error.name).toBe('AbortError');
  });

  it.each([
    'incomplete',
    'failed',
    'cancelled',
    'queued',
    'in_progress',
    undefined,
  ])('rejects a schema-valid JSON result when status is %s', (status) => {
    expect(() =>
      assertCompletedChatResponse(
        {
          status,
          output: [
            {
              type: 'message',
              status: 'completed',
              content: [{ type: 'output_text', text: '{"ok":true}' }],
            },
          ],
        },
        'responses',
      ),
    ).toThrow('not completed');
  });

  it('rejects an unfinished tool call inside a completed envelope', () => {
    expect(() =>
      assertCompletedChatResponse(
        {
          status: 'completed',
          output: [
            {
              type: 'function_call',
              status: 'incomplete',
              arguments: '{"ok":true}',
            },
          ],
        },
        'responses',
      ),
    ).toThrow('unfinished');
  });

  it.each(['length', 'content_filter', undefined, 'unknown'])(
    'rejects chat finish_reason %s even for valid JSON',
    (finish_reason) => {
      expect(() =>
        assertCompletedChatResponse(
          { choices: [{ finish_reason, message: { content: '{"ok":true}' } }] },
          'chat-completions',
        ),
      ).toThrow();
    },
  );

  it('does not treat refusal content as a transport error or rewrite it', () => {
    const response = {
      status: 'completed',
      output: [
        {
          type: 'message',
          status: 'completed',
          content: [{ type: 'refusal', refusal: 'Declined' }],
        },
      ],
    };
    expect(() =>
      assertCompletedChatResponse(response, 'responses'),
    ).not.toThrow();
    expect(response.output[0].content[0].type).toBe('refusal');
  });

  it('rejects unverified streaming before sending a request', async () => {
    const upstream = jest.spyOn(globalThis, 'fetch');
    const http = createChatFetch({
      mode: 'direct',
      role: 'STANDARD',
      api: 'responses',
    });
    await expect(
      http('https://provider.invalid/v1/responses', {
        body: JSON.stringify({ stream: true }),
      }),
    ).rejects.toThrow('Streaming');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects an SDK auto-switch to an unapproved API surface', async () => {
    const upstream = jest.spyOn(globalThis, 'fetch');
    const http = createChatFetch({
      mode: 'direct',
      role: 'FAST',
      api: 'chat-completions',
    });
    await expect(
      http('https://yandex.invalid/v1/responses', { body: '{}' }),
    ).rejects.toThrow('Unapproved');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('preserves the original abort error and signal', async () => {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    const upstream = jest.spyOn(globalThis, 'fetch').mockRejectedValue(error);
    const controller = new AbortController();
    const http = createChatFetch({
      mode: 'direct',
      role: 'STANDARD',
      api: 'responses',
    });
    await expect(
      http('https://provider.invalid/v1/responses', {
        body: '{}',
        signal: controller.signal,
      }),
    ).rejects.toBe(error);
    expect(upstream.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it.each([
    { headers: {}, cost: null },
    { headers: { 'x-litellm-response-cost': '0' }, cost: null },
    {
      headers: {
        'x-support-cost-status': 'gateway-estimate',
        'x-litellm-response-cost': '0',
      },
      cost: 0,
    },
    {
      headers: {
        'x-support-cost-status': 'gateway-estimate',
        'x-litellm-response-cost': 'NaN',
      },
      cost: null,
    },
  ])(
    'keeps unverified or invalid cost unknown: %j',
    async ({ headers, cost }) => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'completed', output: [] }), {
          headers,
        }),
      );
      const http = createChatFetch({
        mode: 'gateway',
        role: 'STANDARD',
        api: 'responses',
      });
      await http('http://gateway.invalid/v1/responses', {
        body: '{"model":"support-standard"}',
      });
      expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
        usageScope: 'gateway_request',
        costUsd: cost,
      });
    },
  );
});
