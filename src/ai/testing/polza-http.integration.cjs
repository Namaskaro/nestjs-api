// Real LangChain/OpenAI SDK and loopback HTTP. All external fetches are intercepted.
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
process.env.LANGSMITH_TRACING = 'false'; process.env.LANGCHAIN_TRACING_V2 = 'false';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Logger } = require('@nestjs/common'); Logger.overrideLogger(false);
const { AiService } = require('../ai.service.ts');
const { createAgent } = require('langchain');
const { HumanMessage } = require('@langchain/core/messages');
const { ProductWorkspaceModelPlanSchema } = require('../../product-consultation/application/workspace/product-workspace-model-plan.ts');
const { customerHelpPrompt } = require('../../support-agent/agents/customer-help-agent/prompts/customer-help.prompt.ts');
const { createSearchKnowledgeTool } = require('../../support-agent/agents/customer-help-agent/tools/search-knowledge.tool.ts');

test('Yandex primary, Qwen through Polza fallback: actual SDK and application contracts', async t => {
  const requests = [], sockets = new Set(); let reply;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const request = { path: req.url, body: JSON.parse(body) }; requests.push(request); reply(request, res);
    });
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const native = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok(['polza.ai', 'yandex.invalid'].includes(url.hostname), 'No external HTTP allowed');
    return native(`http://127.0.0.1:${server.address().port}/${url.hostname}${url.pathname}`, init);
  };
  const config = { CHAT_FAST: 'yandex-lite', CHAT_STANDARD: 'yandex-standard',
    CHAT_FAST_FALLBACK: 'qwen-flash', CHAT_STANDARD_FALLBACK: 'qwen-max',
    YANDEX_API_KEY: 'offline', YANDEX_API_URL: 'https://yandex.invalid/v1', YANDEX_LITE_MODEL: 'gpt://fixture/lite', YANDEX_MODEL: 'gpt://fixture/standard',
    POLZA_API_KEY: 'offline', EMBEDDING_PROVIDER: 'yandex', EMBEDDING_FALLBACK_PROVIDER: 'qwen', QWEN_EMBEDDING_DIMENSIONS: 2,
    CHAT_REQUEST_TIMEOUT_MS: 500, EMBEDDING_REQUEST_TIMEOUT_MS: 150 };
  const ai = (extra = {}) => new AiService({ get: k => ({ ...config, ...extra })[k] });
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const chat = (res, content = 'ok', extra = {}, finish = 'stop') => json(res, 200, { id: `chat_fixture_${requests.length}`, model: 'fixture', choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content, ...extra } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
  const failure = (res, status = 503, code = 'unavailable') => json(res, status, { error: { code, message: 'offline fixture' } });
  const primary = q => q.path.includes('yandex.invalid');
  try {
    for (const [role, model] of [['FAST', 'qwen/qwen3.8-flash'], ['STANDARD', 'qwen/qwen3.8-max']]) {
      await t.test(`${role}: successful Yandex sends once; outage uses correct Polza model once`, async () => {
        requests.length = 0; reply = (_q, r) => chat(r);
        const m = ai().getChatModel(role); await m.invoke('hello');
        assert.equal(requests.length, 1); assert.ok(primary(requests[0]));
        requests.length = 0; reply = (q, r) => primary(q) ? failure(r) : chat(r);
        assert.equal((await m.invoke('hello')).text, 'ok');
        assert.equal(requests.length, 2);
        assert.equal(requests[1].path, '/polza.ai/api/v1/chat/completions');
        assert.equal(requests[1].body.model, model);
        assert.equal('enable_thinking' in requests[1].body, false);
        assert.equal('reasoning' in requests[1].body, false);
      });
    }
    await t.test('Polza failure stops after two physical sends, without hidden retries', async () => {
      requests.length = 0; reply = (_q, r) => failure(r);
      await assert.rejects(ai().getChatModel('FAST').invoke('q'), e => e.status === 503);
      assert.equal(requests.length, 2);
    });
    for (const [status, code] of [[401, 'unauthorized'], [429, 'insufficient_quota'], [400, 'invalid_schema']]) {
      await t.test(`${status}/${code} on primary does not switch`, async () => {
        requests.length = 0; reply = (_q, r) => failure(r, status, code);
        await assert.rejects(ai().getChatModel('FAST').invoke('q'));
        assert.equal(requests.length, 1);
      });
    }
    await t.test('real Workspace schema via jsonSchema/includeRaw preserves completed JSON and local application validation', async () => {
      requests.length = 0; const candidate = { operations: [], clarification: 'Какой товар подобрать?' };
      reply = (q, r) => primary(q) ? failure(r) : chat(r, JSON.stringify(candidate));
      const result = await ai().getChatModel('STANDARD').withStructuredOutput(ProductWorkspaceModelPlanSchema, { method: 'jsonSchema', strict: false, includeRaw: true }).invoke('Return JSON');
      assert.deepEqual(ProductWorkspaceModelPlanSchema.parse(result.parsed), candidate);
      assert.ok(result.raw); assert.equal(requests.length, 2);
      assert.equal(requests[1].body.response_format.type, 'json_schema');
      assert.ok(requests[1].body.response_format.json_schema.schema.properties.operations);
      // The application's Zod validator remains authoritative, not an HTTP 200.
      requests.length = 0; reply = (_q, r) => chat(r, '{"operations":[],"clarification":42}');
      await assert.rejects(ai().getChatModel('STANDARD').withStructuredOutput(ProductWorkspaceModelPlanSchema, { method: 'jsonSchema', includeRaw: true }).invoke('Return JSON'), e => e.issues?.some(issue => issue.path[0] === 'clarification'));
      assert.equal(requests.length, 1);
    });
    await t.test('Customer Help real createAgent + read-only tool executes once despite fallback on final model round', async () => {
      requests.length = 0; let executions = 0;
      const search = createSearchKnowledgeTool({ search: async query => { executions++; assert.equal(query, 'Доставка'); return { key: 'shipping', section: 'Shipping', topic: null, question: 'Доставка', answer: 'Завтра', notice: null, footnote: null }; } });
      reply = (q, r) => {
        if (!q.body.messages.some(m => m.role === 'tool')) return chat(r, '', { tool_calls: [{ id: 'lookup_once', type: 'function', function: { name: search.name, arguments: '{"query":"Доставка"}' } }] }, 'tool_calls');
        if (primary(q)) return failure(r);
        assert.equal(q.body.messages.at(-1).tool_call_id, 'lookup_once');
        assert.equal(JSON.parse(q.body.messages.at(-1).content).found, true);
        assert.equal(q.body.tools[0].function.name, search.name);
        chat(r, 'Завтра');
      };
      const agent = createAgent({ model: ai().getChatModel('FAST'), systemPrompt: customerHelpPrompt, tools: [search] });
      const events = [];
      for await (const event of agent.streamEvents({ messages: [new HumanMessage('Доставка')] }, { version: 'v2' })) events.push(event);
      assert.equal(executions, 1); assert.equal(requests.length, 3);
      assert.equal(events.filter(e => e.event === 'on_tool_end').length, 1);
      assert.ok(events.some(e => e.event === 'on_chat_model_end'));
      assert.equal(events.at(-1).data.output.messages.at(-1).text, 'Завтра');
    });
    await t.test('Polza truncated response is rejected, without retry', async () => {
      requests.length = 0; reply = (q, r) => primary(q) ? failure(r) : chat(r, 'partial', {}, 'length');
      await assert.rejects(ai().getChatModel('FAST').invoke('q'));
      assert.equal(requests.length, 2);
    });
    await t.test('Qwen embedding uses /embeddings, configured model, full vector validation and no dimensions/thinking parameter', async () => {
      requests.length = 0; reply = (_q, r) => json(r, 200, { data: [{ index: 0, embedding: [0.1, 0.2] }] });
      for (const model of ['qwen/qwen3-embedding-4b', 'qwen/qwen3-embedding-8b']) {
        assert.deepEqual(await ai({ QWEN_EMBEDDING_MODEL: model }).createEmbedding('text', 'qwen', 'document'), [0.1, 0.2]);
        assert.equal(requests.at(-1).path, '/polza.ai/api/v1/embeddings');
        assert.deepEqual(requests.at(-1).body, { model, input: 'text', encoding_format: 'float' });
      }
      assert.equal(requests.length, 2);
    });
    for (const [status, code, category] of [[503, 'unavailable', 'availability'], [401, 'unauthorized', 'configuration'], [429, 'insufficient_quota', 'configuration'], [429, 'rate_limit_exceeded', 'availability']]) {
      await t.test(`Polza embedding ${status}/${code} has bounded classification and one send`, async () => {
        requests.length = 0; reply = (_q, r) => failure(r, status, code);
        await assert.rejects(ai().createEmbedding('text', 'qwen', 'query'), e => e.category === category);
        assert.equal(requests.length, 1);
      });
    }
    await t.test('Polza invalid dimension is a data error; preabort sends zero; timeout sends once', async () => {
      requests.length = 0; reply = (_q, r) => json(r, 200, { data: [{ index: 0, embedding: [1] }] });
      await assert.rejects(ai().createEmbedding('text', 'qwen', 'query'), e => e.category === 'invalid-response'); assert.equal(requests.length, 1);
      requests.length = 0; const c = new AbortController(); c.abort();
      await assert.rejects(ai().createEmbedding('text', 'qwen', 'query', { signal: c.signal })); assert.equal(requests.length, 0);
      reply = () => {}; const start = performance.now();
      await assert.rejects(ai().createEmbedding('text', 'qwen', 'query'), e => e.category === 'availability');
      assert.equal(requests.length, 1); assert.ok(performance.now() - start < 2000);
    });
  } finally {
    globalThis.fetch = native; for (const socket of sockets) socket.destroy(); await new Promise(r => server.close(r));
  }
});
