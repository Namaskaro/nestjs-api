import { assertCompletedChatResponse, createChatFetch } from './chat-http';

describe('completion safety at the HTTP boundary', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('discards late success from a custom fetch that ignores abort, preserving cancellation identity', async () => {
    const caller = new AbortController();
    const reason = new DOMException('Timed out', 'TimeoutError');
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      caller.abort(reason);
      return new Response('{"status":"completed","output":[]}');
    });
    await expect(
      createChatFetch({ api: 'responses' })(
        'https://offline.invalid/v1/responses',
        { body: '{}', signal: caller.signal },
      ),
    ).rejects.toBe(reason);
    expect(reason.name).toBe('TimeoutError');
  });

  it('preserves an abort while the response body is being read', async () => {
    const error = new Error('Aborted while reading');
    error.name = 'AbortError';
    const response = new Response('{}');
    jest.spyOn(response, 'clone').mockReturnValue({
      text: jest.fn().mockRejectedValue(error),
    } as unknown as Response);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const http = createChatFetch({
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

  it.each(['length', 'content_filter', 'refusal', undefined, null, 'unknown'])(
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
});
