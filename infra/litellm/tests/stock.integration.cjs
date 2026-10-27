// Real LangChain/OpenAI SDK -> unmodified Docker LiteLLM -> local HTTP fixture.
// These are acceptance assertions, including currently failing contracts.
require('ts-node/register/transpile-only');
process.env.LANGSMITH_TRACING = 'false';
process.env.LANGCHAIN_TRACING_V2 = 'false';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, ToolMessage } = require('@langchain/core/messages');
const { z } = require('zod');
const { getChatTransport } = require('../../../src/ai/chat-transport.ts');
const { createChatFetch } = require('../../../src/ai/chat-http.ts');
const control = 'http://127.0.0.1:34580';
const gateway = 'http://127.0.0.1:34581/v1';
const directControl = process.env.STOCK_DIRECT_CONTROL === '1';
const caseFilter = process.env.STOCK_CASE_FILTER;
// Optional baseline measurement uses the unchanged AiService and bypasses only
// the gateway. Real native HTTP still reaches the identical local mock server.
if (directControl) {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (['api.openai.com', 'yandex.invalid'].includes(url.hostname)) {
      const provider = url.hostname === 'api.openai.com' ? 'openai' : 'yandex';
      return nativeFetch(`${control}/${provider}${url.pathname}`, init);
    }
    assert.equal(url.origin, control, 'offline requests only');
    return nativeFetch(input, init);
  };
}
const value = { value: 'offline result', count: 2 };
const schema = z
  .object({ value: z.string().min(1), count: z.number().int() })
  .strict();
const tools = [
  {
    type: 'function',
    function: {
      name: 'emit_result',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' }, count: { type: 'integer' } },
        required: ['value', 'count'],
        additionalProperties: false,
      },
    },
  },
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path, body) {
  const res = await fetch(control + path, {
    ...(body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  return data;
}
const fixtures = (...replies) => api('/fixtures', { replies });
const seen = () => api('/requests');
function client(provider, role, timeout = 2500) {
  const model =
    provider === 'openai'
      ? role === 'FAST'
        ? 'gpt-6-luna'
        : 'gpt-6.1-sol'
      : 'gpt://offline/yandexgpt/latest';
  if (directControl) {
    const { AiService } = require('../../../src/ai/ai.service.ts');
    require('@nestjs/common').Logger.overrideLogger(false);
    const config = {
      CHAT_PROVIDER: provider,
      EMBEDDING_PROVIDER: 'yandex',
      CHAT_REQUEST_TIMEOUT_MS: timeout,
      OPENAI_API_KEY: 'sk-offline-openai',
      OPENAI_FAST_MODEL: model,
      OPENAI_STANDARD_MODEL: model,
      YANDEX_API_KEY: 'sk-offline-yandex',
      YANDEX_API_URL: 'https://yandex.invalid/v1',
      YANDEX_LITE_MODEL: model,
      YANDEX_MODEL: model,
    };
    return new AiService({ get: (key) => config[key] }).getChatModel(role);
  }
  return new ChatOpenAI({
    ...getChatTransport(provider, role, model),
    model: `support-${role.toLowerCase()}`,
    apiKey: 'sk-offline-gateway',
    maxRetries: 0,
    timeout,
    disableStreaming: true,
    configuration: {
      baseURL: gateway,
      fetch: createChatFetch({
        api: provider === 'openai' ? 'responses' : 'chat-completions',
      }),
    },
  });
}
function toolBody(provider, args = JSON.stringify(value)) {
  if (provider === 'yandex')
    return {
      id: 'chatcmpl_offline',
      object: 'chat.completion',
      created: 1,
      model: 'fixture',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_offline',
                type: 'function',
                function: { name: 'emit_result', arguments: args },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  return {
    id: 'resp_offline',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'fixture',
    error: null,
    incomplete_details: null,
    output: [
      {
        type: 'reasoning',
        id: 'rs_offline',
        summary: [],
        encrypted_content: 'offline-encrypted',
      },
      {
        type: 'function_call',
        id: 'fc_offline',
        call_id: 'call_offline',
        status: 'completed',
        name: 'emit_result',
        arguments: args,
      },
    ],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens_details: { reasoning_tokens: 2 },
    },
  };
}
function textBody(provider, text = 'Done.') {
  const body = toolBody(provider);
  if (provider === 'yandex')
    body.choices = [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: text },
      },
    ];
  else
    body.output = [
      {
        type: 'message',
        id: 'msg_offline',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ];
  return body;
}
async function waitFor(predicate, description, limit = 2000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    if (await predicate()) return;
    await pause(20);
  }
  assert.fail(description);
}
test(
  'stock LiteLLM acceptance matrix (offline)',
  { timeout: 240000 },
  async (t) => {
    const { version } = await api('/ready');
    const results = [];
    const check = async (name, run) =>
      caseFilter && !new RegExp(caseFilter).test(name)
        ? undefined
        : t.test(name, async () => {
            const start = Date.now();
            try {
              await run();
              results.push({ name, passed: true, ms: Date.now() - start });
            } catch (error) {
              results.push({
                name,
                passed: false,
                error: error.message,
                ms: Date.now() - start,
                observed: await seen(),
              });
              throw error;
            }
          });
    try {
      for (const providers of [
        ['yandex', 'openai'],
        ['openai', 'yandex'],
        ['openai', 'openai'],
        ['yandex', 'yandex'],
      ]) {
        await api('/configure', { providers });
        await check(
          `${providers.join('/')}: concurrent roles isolate cancellation`,
          async () => {
            await fixtures(
              { body: textBody(providers[0]), delayMs: 10000 },
              { body: textBody(providers[1]) },
            );
            const controller = new AbortController();
            const first = client(providers[0], 'FAST')
              .invoke('Slow', { signal: controller.signal })
              .then(
                (value) => ({ value }),
                (error) => ({ error }),
              );
            try {
              await waitFor(
                async () => (await seen()).requests.length > 0,
                'FAST never reached upstream',
              );
              assert.equal(
                (await client(providers[1], 'STANDARD').invoke('Independent'))
                  .text,
                'Done.',
              );
              controller.abort();
              assert.ok((await first).error, 'cancelled role must reject');
              await waitFor(
                async () => (await seen()).requests[0]?.disconnected,
                'cancelled upstream socket did not close',
              );
              const { requests } = await seen();
              assert.equal(requests.length, 2);
              assert.equal(requests[1].disconnected, false);
            } finally {
              controller.abort();
              await first;
            }
          },
        );
        for (const [i, role] of ['FAST', 'STANDARD'].entries()) {
          const provider = providers[i];
          const prefix = `${providers.join('/')} ${role}`;
          const structured = (method = 'functionCalling') =>
            client(provider, role).withStructuredOutput(schema, {
              name: 'emit_result',
              method,
              ...(method === 'functionCalling' ? { strict: false } : {}),
              includeRaw: true,
            });
          await check(
            `${prefix}: structured tools/Zod/includeRaw and native route`,
            async () => {
              await fixtures({ body: toolBody(provider) });
              const result = await structured().invoke('Use the schema');
              assert.deepEqual(result.parsed, value);
              assert.equal(result.raw.tool_calls[0].id, 'call_offline');
              const { requests } = await seen();
              assert.equal(requests.length, 1);
              const req = requests[0];
              assert.equal(
                req.path,
                `/${provider}/v1/${
                  provider === 'openai' ? 'responses' : 'chat/completions'
                }`,
              );
              assert.equal(req.authorization, `Bearer sk-offline-${provider}`);
              if (provider === 'openai') {
                assert.equal(
                  req.body.model,
                  role === 'FAST' ? 'gpt-6-luna' : 'gpt-6.1-sol',
                );
                assert.equal(
                  req.body.reasoning.effort,
                  role === 'FAST' ? 'none' : 'medium',
                );
                assert.equal(req.body.store, false);
                assert.ok(
                  req.body.include.includes('reasoning.encrypted_content'),
                );
                assert.equal(req.body.tools[0].name, 'emit_result');
                assert.equal(req.body.tool_choice.name, 'emit_result');
                if (role === 'STANDARD')
                  assert.equal(req.body.temperature, undefined);
              } else {
                assert.equal(req.body.model, 'gpt://offline/yandexgpt/latest');
                assert.equal(req.body.tools[0].function.name, 'emit_result');
                assert.equal(req.body.tool_choice.function.name, 'emit_result');
              }
            },
          );
          for (const method of ['jsonMode', 'jsonSchema'])
            await check(`${prefix}: ${method} and Zod validation`, async () => {
              await fixtures(
                { body: textBody(provider, JSON.stringify(value)) },
                { body: textBody(provider, '{"value":123,"count":"bad"}') },
              );
              assert.deepEqual(
                (await structured(method).invoke('Return JSON')).parsed,
                value,
              );
              // Without includeRaw the parser must throw on schema violations. With
              // includeRaw the installed SDK may return parsed:undefined instead.
              await assert.rejects(
                client(provider, role)
                  .withStructuredOutput(schema, { name: 'emit_result', method })
                  .invoke('Return JSON'),
                /invalid|expected/i,
              );
              const { requests } = await seen();
              assert.equal(requests.length, 2);
              const format =
                provider === 'openai'
                  ? requests[0].body.text.format
                  : requests[0].body.response_format;
              assert.equal(
                format.type,
                method === 'jsonMode' ? 'json_object' : 'json_schema',
              );
            });
          await check(
            `${prefix}: tool result and encrypted reasoning history`,
            async () => {
              await fixtures(
                { body: toolBody(provider) },
                { body: textBody(provider) },
              );
              const model = client(provider, role).bindTools(tools);
              const user = new HumanMessage('Use a tool');
              const first = await model.invoke([user]);
              assert.deepEqual(first.tool_calls[0].args, value);
              const second = await model.invoke([
                user,
                first,
                new ToolMessage({
                  tool_call_id: 'call_offline',
                  content: 'Tool succeeded.',
                }),
              ]);
              assert.equal(second.text, 'Done.');
              const { requests } = await seen();
              assert.equal(requests.length, 2);
              const body = requests[1].body;
              if (provider === 'openai') {
                assert.ok(
                  body.input.some(
                    (x) =>
                      x.type === 'reasoning' &&
                      x.encrypted_content === 'offline-encrypted',
                  ),
                );
                assert.ok(
                  body.input.some(
                    (x) =>
                      x.type === 'function_call' &&
                      x.call_id === 'call_offline' &&
                      x.arguments === JSON.stringify(value),
                  ),
                );
                assert.ok(
                  body.input.some(
                    (x) =>
                      x.type === 'function_call_output' &&
                      x.call_id === 'call_offline' &&
                      x.output === 'Tool succeeded.',
                  ),
                );
              } else {
                assert.ok(
                  body.messages.some(
                    (x) =>
                      x.role === 'tool' &&
                      x.tool_call_id === 'call_offline' &&
                      x.content === 'Tool succeeded.',
                  ),
                );
                assert.ok(
                  body.messages.some(
                    (x) =>
                      x.role === 'assistant' &&
                      x.tool_calls?.[0].id === 'call_offline',
                  ),
                );
              }
            },
          );
          await check(
            `${prefix}: refusal has no structured success`,
            async () => {
              const body = textBody(provider, '');
              if (provider === 'openai')
                body.output[0].content = [
                  { type: 'refusal', refusal: 'Offline refusal' },
                ];
              else
                body.choices[0].message = {
                  role: 'assistant',
                  content: null,
                  refusal: 'Offline refusal',
                };
              await fixtures({ body });
              const result = await structured().invoke('Return result');
              assert.ok(
                result.parsed == null,
                'refusal must not produce a parsed success',
              );
              if (provider === 'openai')
                assert.equal(
                  result.raw.additional_kwargs.refusal,
                  'Offline refusal',
                );
              assert.equal((await seen()).requests.length, 1);
            },
          );
          await check(
            `${prefix}: malformed completed tool JSON has no parsed success`,
            async () => {
              await fixtures({ body: toolBody(provider, '{broken JSON') });
              const result = await structured().invoke('Use schema');
              assert.ok(result.parsed == null);
              assert.equal(result.raw.tool_calls.length, 0);
              assert.equal(
                result.raw.invalid_tool_calls[0].args,
                '{broken JSON',
              );
              assert.equal((await seen()).requests.length, 1);
            },
          );
          await check(
            `${prefix}: incomplete valid tool arguments cannot execute`,
            async () => {
              const body = toolBody(provider);
              if (provider === 'openai') {
                body.status = 'incomplete';
                body.incomplete_details = { reason: 'max_output_tokens' };
              } else body.choices[0].finish_reason = 'length';
              await fixtures({ body });
              await assert.rejects(
                client(provider, role).bindTools(tools).invoke('Use tool'),
              );
              assert.equal((await seen()).requests.length, 1);
            },
          );
          await check(
            `${prefix}: pre-abort has zero physical sends`,
            async () => {
              await fixtures();
              const controller = new AbortController();
              controller.abort();
              await assert.rejects(
                client(provider, role).invoke('Hello', {
                  signal: controller.signal,
                }),
              );
              assert.equal((await seen()).requests.length, 0);
            },
          );
          for (const kind of ['abort', 'client timeout', 'gateway timeout'])
            await check(
              `${prefix}: ${kind} closes upstream without replay`,
              async () => {
                await fixtures({ body: textBody(provider), delayMs: 10000 });
                const controller = new AbortController();
                const start = Date.now();
                const call = client(
                  provider,
                  role,
                  kind === 'client timeout' ? 250 : 6000,
                ).invoke('Slow', { signal: controller.signal });
                const rejected = assert.rejects(call);
                await waitFor(
                  async () => (await seen()).requests.length > 0,
                  'no physical upstream request',
                );
                if (kind === 'abort') controller.abort();
                await rejected;
                assert.ok(
                  Date.now() - start <
                    (kind === 'gateway timeout' ? 5000 : 2000),
                  'bounded timeout',
                );
                await waitFor(
                  async () => (await seen()).requests[0]?.disconnected,
                  'upstream socket did not close',
                );
                assert.equal((await seen()).requests.length, 1);
              },
            );
          await check(
            `${prefix}: connection drop must not cause hidden resend`,
            async () => {
              await fixtures({ close: true }, { body: textBody(provider) });
              const result = await client(provider, role)
                .invoke('Hello')
                .then(
                  () => 'success',
                  () => 'error',
                );
              const { requests } = await seen();
              assert.equal(
                requests.length,
                1,
                `physical sends=${requests.length}, outcome=${result}`,
              );
              assert.equal(result, 'error');
            },
          );
          for (const status of [401, 429, 503])
            await check(`${prefix}: HTTP ${status} no retry`, async () => {
              await fixtures({
                status,
                body: {
                  error: {
                    message: 'Offline provider error',
                    type: 'api_error',
                    code:
                      status === 429 ? 'insufficient_quota' : 'offline_failure',
                  },
                },
              });
              await assert.rejects(
                client(provider, role).invoke('Hello'),
                (error) => error.status === status,
              );
              assert.equal((await seen()).requests.length, 1);
            });
          if (provider === 'yandex')
            for (const reason of [null, 'missing', 'unknown', 'content_filter'])
              await check(
                `${prefix}: rejects unconfirmed finish_reason=${reason}`,
                async () => {
                  const body = toolBody(provider);
                  if (reason === 'missing')
                    delete body.choices[0].finish_reason;
                  else body.choices[0].finish_reason = reason;
                  await fixtures({ body });
                  await assert.rejects(
                    client(provider, role).bindTools(tools).invoke('Use tool'),
                    'must reject before tool execution',
                  );
                  assert.equal((await seen()).requests.length, 1);
                },
              );
        }
      }
    } finally {
      fs.mkdirSync('.tmp', { recursive: true });
      fs.writeFileSync(
        `.tmp/stock-${directControl ? 'direct-control' : version}.json`,
        JSON.stringify(
          {
            version,
            directControl,
            caseFilter,
            passed: results.filter((x) => x.passed).length,
            failed: results.filter((x) => !x.passed).length,
            results,
          },
          null,
          2,
        ),
      );
    }
  },
);
