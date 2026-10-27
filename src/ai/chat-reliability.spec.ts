import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AiService } from './ai.service';

// Real LangChain + OpenAI SDK, including its timer/retry logic. No external HTTP.
function ai(provider: 'openai' | 'yandex', timeout = 1000) {
  const values = {
    CHAT_PROVIDER: provider,
    EMBEDDING_PROVIDER: 'yandex',
    CHAT_REQUEST_TIMEOUT_MS: timeout,
    OPENAI_API_KEY: 'offline',
    OPENAI_FAST_MODEL: 'gpt-6-luna',
    OPENAI_STANDARD_MODEL: 'gpt-6.1-sol',
    YANDEX_API_KEY: 'offline',
    YANDEX_API_URL: 'https://yandex.invalid/v1',
    YANDEX_LITE_MODEL: 'gpt://offline/lite',
    YANDEX_MODEL: 'gpt://offline/standard',
  };
  return new AiService({ get: (key: string) => values[key] } as ConfigService);
}
function completed(provider: 'openai' | 'yandex') {
  return new Response(
    JSON.stringify(
      provider === 'openai'
        ? {
            id: 'resp_test',
            status: 'completed',
            output: [
              {
                type: 'message',
                id: 'msg_test',
                role: 'assistant',
                status: 'completed',
                content: [
                  { type: 'output_text', text: 'Done', annotations: [] },
                ],
              },
            ],
          }
        : {
            id: 'chat_test',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'Done' },
              },
            ],
          },
    ),
    { headers: { 'content-type': 'application/json' } },
  );
}
// Node's DOMException belongs to a different realm in Jest. Emit a local
// spec-compliant AbortError so the SDK sees the same shape as native fetch
// outside Jest. Real socket/body timeout coverage also runs in node:test.
function fetchAbort(signal: AbortSignal) {
  return Object.assign(new Error('The operation was aborted'), {
    name: 'AbortError',
    cause: signal.reason,
  });
}
describe.each(['openai', 'yandex'] as const)(
  '%s direct request reliability',
  (provider) => {
    beforeEach(() => {
      jest.replaceProperty(process, 'env', {
        ...process.env,
        LANGSMITH_TRACING: 'false',
        LANGCHAIN_TRACING_V2: 'false',
      });
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());
    it('does not send an already aborted request', async () => {
      const upstream = jest.spyOn(globalThis, 'fetch');
      const controller = new AbortController();
      controller.abort();
      await expect(
        ai(provider)
          .getChatModel('STANDARD')
          .invoke('Hello', { signal: controller.signal }),
      ).rejects.toThrow();
      expect(upstream).not.toHaveBeenCalled();
    });
    it.each([401, 403, 429, 503])(
      'preserves HTTP %s, provider code and request ID with exactly one send',
      async (status) => {
        const upstream = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: 'Provider error',
                type: 'api_error',
                code: 'original_code',
              },
            }),
            {
              status,
              headers: {
                'content-type': 'application/json',
                'x-request-id': 'offline-id',
              },
            },
          ),
        );
        await expect(
          ai(provider).getChatModel('STANDARD').invoke('Hello'),
        ).rejects.toMatchObject({
          status,
          code: 'original_code',
          requestID: 'offline-id',
        });
        expect(upstream).toHaveBeenCalledTimes(1);
      },
    );
    it('does not retry a connection failure', async () => {
      const upstream = jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new TypeError('Connection lost'));
      await expect(
        ai(provider).getChatModel('STANDARD').invoke('Hello'),
      ).rejects.toThrow();
      expect(upstream).toHaveBeenCalledTimes(1);
    });
    it('uses the SDK timeout during a stalled connection without a retry', async () => {
      const upstream = jest.spyOn(globalThis, 'fetch').mockImplementation(
        async (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init!.signal!;
            if (signal.aborted) reject(fetchAbort(signal));
            else
              signal.addEventListener(
                'abort',
                () => reject(fetchAbort(signal)),
                {
                  once: true,
                },
              );
          }),
      );
      await expect(
        ai(provider, 40).getChatModel('STANDARD').invoke('Hello'),
      ).rejects.toThrow(/timed out/i);
      expect(upstream).toHaveBeenCalledTimes(1);
    });
    it.each([200, 503])(
      'bounds a stalled HTTP %s body, not just response headers',
      async (status) => {
        const upstream = jest
          .spyOn(globalThis, 'fetch')
          .mockImplementation(async (_url, init) => {
            const signal = init!.signal!;
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{'));
                  signal.addEventListener(
                    'abort',
                    () => controller.error(fetchAbort(signal)),
                    { once: true },
                  );
                },
              }),
              { status },
            );
          });
        await expect(
          ai(provider, 40).getChatModel('STANDARD').invoke('Hello'),
        ).rejects.toThrow(/timed out/i);
        expect(upstream).toHaveBeenCalledTimes(1);
      },
    );
    it('isolates concurrent cancellations and can run again after cleanup', async () => {
      let firstStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const upstream = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementationOnce(
          async (_url, init) =>
            new Promise((_resolve, reject) => {
              init!.signal!.addEventListener(
                'abort',
                () => reject(init!.signal!.reason),
                { once: true },
              );
              firstStarted();
            }),
        )
        .mockImplementation(async () => completed(provider));
      const model = ai(provider).getChatModel('STANDARD');
      const controller = new AbortController();
      const cancelled = expect(
        model.invoke('First', { signal: controller.signal }),
      ).rejects.toThrow(/abort/i);
      await started;
      expect((await model.invoke('Concurrent')).text).toBe('Done');
      controller.abort();
      await cancelled;
      expect((await model.invoke('After cleanup')).text).toBe('Done');
      expect(upstream).toHaveBeenCalledTimes(3);
    });
    it('rejects a late response even if an injected fetch ignores cancellation', async () => {
      const controller = new AbortController();
      const upstream = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => {
          controller.abort();
          return completed(provider);
        });
      await expect(
        ai(provider)
          .getChatModel('STANDARD')
          .invoke('Hello', { signal: controller.signal }),
      ).rejects.toThrow(/abort/i);
      expect(upstream).toHaveBeenCalledTimes(1);
    });
  },
);
