// Run: node --test src/ai/testing/direct-http.integration.cjs
// Real SDK + native fetch + disposable loopback HTTP. Never contact providers.
require('ts-node/register/transpile-only');
process.env.LANGSMITH_TRACING = 'false';
process.env.LANGCHAIN_TRACING_V2 = 'false';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { AiService } = require('../ai.service.ts');
const { Logger } = require('@nestjs/common');
Logger.overrideLogger(false);

test('native direct transport timeout and cancellation contracts', async (t) => {
  let reply;
  let sends = 0;
  const paths = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    sends++;
    paths.push(req.url);
    req.resume();
    reply(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok(
      ['api.openai.com', 'yandex.invalid', 'qwen.invalid'].includes(
        url.hostname,
      ),
    );
    return nativeFetch(
      `http://127.0.0.1:${server.address().port}${url.pathname}`,
      init,
    );
  };
  const ai = (provider) => {
    const config = {
      CHAT_PROVIDER: provider,
      EMBEDDING_PROVIDER: 'yandex',
      CHAT_REQUEST_TIMEOUT_MS: 150,
      OPENAI_API_KEY: 'offline',
      OPENAI_STANDARD_MODEL: 'gpt-6.1-sol',
      YANDEX_API_KEY: 'offline',
      YANDEX_API_URL: 'https://yandex.invalid/v1',
      YANDEX_MODEL: 'gpt://offline/test',
      ...(provider === 'qwen'
        ? {
            QWEN_API_KEY: 'offline',
            QWEN_API_URL: 'https://qwen.invalid/compatible-mode/v1',
            CHAT_STANDARD_MODEL: 'qwen3.7-flash-2026-07-15',
          }
        : {}),
    };
    return new AiService({ get: (key) => config[key] }).getChatModel(
      'STANDARD',
    );
  };
  try {
    for (const provider of ['openai', 'yandex', 'qwen']) {
      for (const status of [null, 200, 503]) {
        await t.test(
          `${provider}: timeout while waiting for ${status ?? 'headers'}`,
          async () => {
            sends = 0;
            let closed;
            const disconnected = new Promise((resolve) => {
              closed = resolve;
            });
            reply = (_req, res) => {
              res.on('close', closed);
              if (status !== null) {
                res.writeHead(status, { 'content-type': 'application/json' });
                res.write('{');
              }
            };
            const start = performance.now();
            await assert.rejects(ai(provider).invoke('Hello'), /timed out/i);
            assert.ok(
              performance.now() - start < 2500,
              'server body must remain inside SDK timeout',
            );
            assert.equal(sends, 1, 'no retry');
            await Promise.race([
              disconnected,
              new Promise((_, reject) => {
                const timer = setTimeout(
                  () => reject(Error('HTTP did not close')),
                  1500,
                );
                timer.unref();
              }),
            ]);
          },
        );
      }
      await t.test(
        `${provider}: preserves native HTTP error details`,
        async () => {
          sends = 0;
          reply = (_req, res) => {
            res.writeHead(429, {
              'content-type': 'application/json',
              'x-request-id': 'native-test',
            });
            res.end(
              JSON.stringify({
                error: {
                  message: 'Quota exhausted',
                  code: 'insufficient_quota',
                  type: 'quota',
                },
              }),
            );
          };
          await assert.rejects(
            ai(provider).invoke('Hello'),
            (error) =>
              error.status === 429 &&
              error.code === 'insufficient_quota' &&
              error.requestID === 'native-test',
          );
          assert.equal(sends, 1);
        },
      );
      await t.test(
        `${provider}: explicit abort closes HTTP without replay`,
        async () => {
          sends = 0;
          let begin;
          let closed;
          const started = new Promise((resolve) => {
            begin = resolve;
          });
          const disconnected = new Promise((resolve) => {
            closed = resolve;
          });
          reply = (_req, res) => {
            res.on('close', closed);
            begin();
          };
          const controller = new AbortController();
          const result = assert.rejects(
            ai(provider).invoke('Hello', { signal: controller.signal }),
            /abort/i,
          );
          await started;
          controller.abort();
          await result;
          await disconnected;
          assert.equal(sends, 1);
        },
      );
    }
    assert.ok(paths.includes('/v1/responses'));
    assert.ok(paths.includes('/v1/chat/completions'));
  } finally {
    globalThis.fetch = nativeFetch;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
