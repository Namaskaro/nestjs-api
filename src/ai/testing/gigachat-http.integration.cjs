// Native GigaChat adapter: same strict assertions as the official-adapter acceptance. Loopback only.
// Expected blockers remain failures; this experimental suite is outside normal CI.
// Install: use the isolated lockfile procedure in this directory's README.md.
// Run from repository root: node --test infra/provider-conformance/gigachat.acceptance.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
require('ts-node/register/transpile-only');
const { DirectGigaChat } = require('../gigachat-model.ts');
const { z } = require('zod');
const { HumanMessage, ToolMessage } = require('@langchain/core/messages');
const { tool } = require('@langchain/core/tools');
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
process.env.LANGSMITH_TRACING = 'false';
process.env.LANGCHAIN_TRACING_V2 = 'false';

test('Native GigaChat adapter mandatory application contracts', async (t) => {
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
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input)); assert.equal(url.hostname, 'giga.invalid');
    return nativeFetch('http://127.0.0.1:' + server.address().port + url.pathname, init);
  };
  const model = () => new DirectGigaChat({ baseURL: 'https://giga.invalid/v1', accessToken: 'offline', model: 'GigaChat-2', timeoutMs: 300 });
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
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GigaChat OAuth, expiry, isolation, strict invalid/refusal handling', async t => {
  const { DirectGigaChat } = require('../gigachat-model.ts');
  const requests=[]; let respond;
  const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{requests.push({path:req.url,headers:req.headers,body});respond(req,res);});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const nativeFetch=globalThis.fetch;
  globalThis.fetch=(input,init)=>{const u=new URL(String(input));assert.ok(['giga.invalid','oauth.invalid'].includes(u.hostname));return nativeFetch('http://127.0.0.1:'+server.address().port+u.pathname,init);};
  const json=(r,status,body)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(body));};
  const answer=(r,text='ok',finish='stop')=>json(r,200,{choices:[{index:0,finish_reason:finish,message:{role:'assistant',content:text}}],model:'GigaChat-2',usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  const model=extra=>new DirectGigaChat({model:'GigaChat-2',baseURL:'https://giga.invalid/v1',authURL:'https://oauth.invalid/oauth',credentials:'offline',timeoutMs:300,...extra});
  try {
    await t.test('concurrent first requests share OAuth; cached token is refreshed before expiry',async()=>{
      requests.length=0;let auths=0;respond=(q,r)=>{if(q.url==='/oauth'){auths++;json(r,200,{access_token:'token'+auths,expires_at:Date.now()+(auths===1?1000:600000)});}else answer(r);};
      const m=model();await Promise.all([m.invoke('a'),m.invoke('b')]);assert.equal(auths,1);assert.equal(requests.filter(q=>q.path!=='/oauth').length,2);
      await m.invoke('c');assert.equal(auths,2);assert.equal(requests.at(-1).headers.authorization,'Bearer token2');
      assert.equal(requests[0].body,'scope=GIGACHAT_API_PERS');assert.equal(requests[0].headers.authorization,'Basic offline');assert.match(requests[0].headers.rquid,/^[0-9a-f-]{36}$/);
    });
    await t.test('one cancelled chat does not cancel shared token refresh',async()=>{
      requests.length=0;const c=new AbortController();respond=(q,r)=>q.url==='/oauth'?setTimeout(()=>json(r,200,{access_token:'fresh',expires_at:Date.now()+600000}),40):answer(r);
      const m=model();const rejected=assert.rejects(m.invoke('cancel',{signal:c.signal}));const other=m.invoke('keep');setTimeout(()=>c.abort(),10);await rejected;assert.equal((await other).text,'ok');assert.equal(requests.filter(q=>q.path==='/oauth').length,1);assert.equal(requests.filter(q=>q.path!=='/oauth').length,1);
    });
    await t.test('auth failure sends no model request; rejected model token causes no same-call replay',async()=>{
      requests.length=0;respond=(_q,r)=>json(r,401,{code:'invalid_credentials'});await assert.rejects(model().invoke('a'),e=>e.status===401);assert.equal(requests.length,1);assert.equal(requests[0].path,'/oauth');
      requests.length=0;await assert.rejects(model({accessToken:'bad'}).invoke('a'),e=>e.status===401);assert.equal(requests.length,1);assert.ok(requests[0].path.endsWith('/chat/completions'));
    });
    await t.test('preabort sends neither OAuth nor chat',async()=>{requests.length=0;const c=new AbortController();c.abort();await assert.rejects(model().invoke('a',{signal:c.signal}));assert.equal(requests.length,0);});
    for(const finish of ['length','blacklist',null,'unknown'])await t.test('reject finish='+finish,async()=>{requests.length=0;respond=(_q,r)=>answer(r,'partial',finish);await assert.rejects(model({accessToken:'offline'}).invoke('a'));assert.equal(requests.length,1);});
    await t.test('Zod validation and includeRaw reject completed invalid fields without retries',async()=>{
      requests.length=0;respond=(_q,r)=>answer(r,'{"value":42}');const schema=z.object({value:z.string()});const m=model({accessToken:'offline'});
      await assert.rejects(m.withStructuredOutput(schema,{method:'jsonSchema'}).invoke('JSON'));
      const output=await m.withStructuredOutput(schema,{method:'jsonMode',includeRaw:true}).invoke('JSON');assert.equal(output.parsed,null);assert.ok(output.raw);assert.equal(requests.length,2);
      const body=JSON.parse(requests[0].body);assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.schema.properties.value.type,'string');assert.equal(body.response_format.strict,true);
    });
    await t.test('all API/auth endpoints require HTTPS; opaque reasoning is rejected before send',async()=>{
      assert.throws(()=>model({baseURL:'http://giga.invalid'}),/HTTPS/);assert.throws(()=>model({authURL:'http://oauth.invalid'}),/HTTPS/);requests.length=0;
      const {AIMessage}=require('@langchain/core/messages');await assert.rejects(model().invoke([new AIMessage({content:[{type:'reasoning',encrypted_content:'secret'}]})]),/opaque/);assert.equal(requests.length,0);
    });
    await t.test('stalled OAuth and stalled response body are bounded',async()=>{
      respond=(_q,r)=>{r.writeHead(200,{'content-type':'application/json'});r.write('{');};
      for(const extra of [{},{accessToken:'offline'}]){const start=Date.now();await assert.rejects(model(extra).invoke('wait'));assert.ok(Date.now()-start<1500);}
    });
  }finally{globalThis.fetch=nativeFetch;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
