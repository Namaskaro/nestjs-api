// Strict acceptance against the official SDK, with loopback HTTP only.
// Expected blockers remain failures; this experimental suite is outside normal CI.
// Install: use the isolated lockfile procedure in this directory's README.md.
// Run from repository root: node --test infra/provider-conformance/gigachat.acceptance.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const load = createRequire(path.resolve('.tmp/gigachat-compat/package.json'));
const { GigaChat } = load('langchain-gigachat');
const { z } = require('zod');
const { HumanMessage, ToolMessage } = require('@langchain/core/messages');
const { tool } = require('@langchain/core/tools');
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
process.env.LANGSMITH_TRACING = 'false';
process.env.LANGCHAIN_TRACING_V2 = 'false';

test('GigaChat 0.0.18 mandatory application contracts', async (t) => {
  const requests = [];
  let respond;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      respond(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const model = () =>
    new GigaChat({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      accessToken: 'offline',
      model: 'GigaChat-2',
      maxRetries: 0,
      timeout: 0.3,
      disableStreaming: true,
    });
  const reply = (res, message, finish = 'stop') => {
    if (requests.at(-1).stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-request-id': 'offline',
      });
      res.end(
        'data: ' +
          JSON.stringify({
            choices: [
              {
                index: 0,
                finish_reason: finish,
                delta: { role: 'assistant', ...message },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
            model: 'GigaChat-2',
            object: 'chat.completion.chunk',
            created: 1,
          }) +
          '\n\ndata: [DONE]\n\n',
      );
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-request-id': 'offline',
    });
    res.end(
      JSON.stringify({
        choices: [
          {
            index: 0,
            finish_reason: finish,
            message: { role: 'assistant', ...message },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'GigaChat-2',
        object: 'chat.completion',
        created: 1,
      }),
    );
  };
  const schema = z.object({ value: z.string().min(1) });
  try {
    await t.test('invoke and usage', async () => {
      respond = (_, res) => reply(res, { content: 'ok' });
      const result = await model().invoke('hello');
      assert.equal(result.text, 'ok');
      assert.equal(result.usage_metadata.total_tokens, 15);
    });
    await t.test(
      'jsonMode required by recommendation synthesizer',
      async () => {
        respond = (_, res) => reply(res, { content: '{"value":"ok"}' });
        const result = await model()
          .withStructuredOutput(schema, { method: 'jsonMode' })
          .invoke('Return JSON');
        assert.equal(result.value, 'ok');
      },
    );
    await t.test('jsonSchema contract', async () => {
      respond = (_, res) => reply(res, { content: '{"value":"ok"}' });
      const result = await model()
        .withStructuredOutput(schema, { method: 'jsonSchema' })
        .invoke('Return JSON');
      assert.equal(result.value, 'ok');
    });
    await t.test(
      'Zod 4 function schema preserves required fields',
      async () => {
        respond = (_, res) =>
          reply(
            res,
            {
              content: '',
              function_call: { name: 'emit', arguments: { value: 'ok' } },
              functions_state_id: 'state-offline',
            },
            'function_call',
          );
        const result = await model()
          .withStructuredOutput(schema, {
            name: 'emit',
            method: 'functionCalling',
            includeRaw: true,
          })
          .invoke('emit');
        assert.equal(result.parsed.value, 'ok');
        const sent = requests.at(-1).functions[0].parameters;
        assert.equal(sent.properties?.value?.type, 'string');
        assert.ok(sent.required.includes('value'));
      },
    );
    await t.test(
      'native function tools preserve state and tool-result history',
      async () => {
        const start = requests.length;
        respond = (_, res) =>
          requests.length === start + 1
            ? reply(
                res,
                {
                  content: '',
                  function_call: { name: 'lookup', arguments: { value: 'ok' } },
                  functions_state_id: 'state-offline',
                },
                'function_call',
              )
            : reply(res, { content: 'done' });
        const bound = model().bindTools([
          {
            name: 'lookup',
            description: 'lookup',
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
          },
        ]);
        const human = new HumanMessage('lookup');
        const first = await bound.invoke([human]);
        await bound.invoke([
          human,
          first,
          new ToolMessage({
            name: 'lookup',
            content: '{"found":true}',
            tool_call_id: first.tool_calls[0].id,
          }),
        ]);
        assert.equal(requests.length - start, 2);
        assert.equal(
          requests.at(-1).messages[1].functions_state_id,
          'state-offline',
        );
        assert.equal(requests.at(-1).messages.at(-1).role, 'function');
      },
    );
    await t.test('LangGraph events with a real Zod 4 tool', async () => {
      const start = requests.length;
      let toolsRun = 0;
      const lookup = tool(
        async ({ value }) => {
          toolsRun++;
          return value;
        },
        { name: 'lookup', description: 'Lookup', schema },
      );
      respond = (_, res) =>
        requests.length === start + 1
          ? reply(
              res,
              {
                content: '',
                function_call: { name: 'lookup', arguments: { value: 'ok' } },
              },
              'function_call',
            )
          : reply(res, { content: 'done' });
      const graph = createReactAgent({ llm: model(), tools: [lookup] });
      const events = [];
      for await (const event of graph.streamEvents(
        { messages: [new HumanMessage('lookup')] },
        { version: 'v2' },
      ))
        events.push(event);
      assert.equal(toolsRun, 1);
      assert.ok(events.some((event) => event.event === 'on_chat_model_end'));
      assert.equal(
        requests[start].functions[0].parameters.properties?.value?.type,
        'string',
      );
    });
    await t.test(
      'incomplete output must not be accepted as tool call',
      async () => {
        respond = (_, res) =>
          reply(
            res,
            {
              content: '',
              function_call: {
                name: 'lookup',
                arguments: { value: 'partial' },
              },
            },
            'length',
          );
        await assert.rejects(model().invoke('lookup'));
      },
    );
    await t.test('abort closes the active HTTP request', async () => {
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      let closed = false;
      respond = (_, res) => {
        res.on('close', () => {
          closed = true;
        });
        started();
      };
      const controller = new AbortController();
      const pending = model().invoke('wait', { signal: controller.signal });
      const rejected = assert.rejects(pending);
      await ready;
      controller.abort();
      await rejected;
      await new Promise((resolve) => setTimeout(resolve, 40));
      const closedOnAbort = closed;
      await new Promise((resolve) => setTimeout(resolve, 320));
      assert.equal(closedOnAbort, true);
    });
    await t.test('SDK timeout bounds a stalled request', async () => {
      const start = Date.now();
      respond = () => {};
      await assert.rejects(model().invoke('wait'));
      assert.ok(Date.now() - start < 1500);
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
