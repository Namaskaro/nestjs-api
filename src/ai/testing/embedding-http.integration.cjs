// Real SDK/native fetch, loopback HTTP only. No provider/Qdrant/PG calls.
require('ts-node/register/transpile-only');
process.env.LANGSMITH_TRACING = 'false'; process.env.LANGCHAIN_TRACING_V2 = 'false';
const { test } = require('node:test'); const assert = require('node:assert/strict'); const http = require('node:http');
const { AiService } = require('../ai.service.ts'); const { EmbeddingRequestError } = require('../embedding-execution.ts');
test('bounded embedding HTTP, classification and zero retries', async t => {
  let reply; let sends = 0; const sockets = new Set();
  const server = http.createServer((req,res) => { sends++; req.resume(); reply(req,res); });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(r => server.listen(0,'127.0.0.1',r)); const native = globalThis.fetch;
  globalThis.fetch = (input,init) => { const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok(['api.openai.com','ai.api.cloud.yandex.net'].includes(url.hostname));
    return native(`http://127.0.0.1:${server.address().port}${url.pathname}`,init); };
  const config = { CHAT_PROVIDER:'yandex', EMBEDDING_PROVIDER:'yandex', EMBEDDING_REQUEST_TIMEOUT_MS:150, OPENAI_API_KEY:'offline', YANDEX_API_KEY:'offline', YANDEX_FOLDER_ID:'offline', YANDEX_EMBEDDING_QUERY_MODEL:'q',YANDEX_EMBEDDING_DOCUMENT_MODEL:'d',YANDEX_EMBEDDING_DIMENSIONS:2,OPENAI_EMBEDDING_MODEL:'text-embedding-3-small',OPENAI_EMBEDDING_DIMENSIONS:2 };
  const ai = () => new AiService({ get: key => config[key] });
  const json = (res,status,body) => { res.writeHead(status,{'content-type':'application/json'}); res.end(JSON.stringify(body)); };
  try {
    for (const provider of ['yandex','openai']) {
      for (const [status,code,category] of [[401,'unauthorized','configuration'],[403,'forbidden','configuration'],[429,'insufficient_quota','configuration'],[429,'unknown','configuration'],[429,'rate_limit_exceeded','availability'],[500,'internal','availability'],[502,'bad_gateway','availability'],[503,'unavailable','availability']]) {
        await t.test(`${provider} HTTP ${status}/${code}`,async () => { sends=0; reply=(_q,r)=>json(r,status,{error:{code,message:'offline fault'}});
          await assert.rejects(ai().createEmbedding('q',provider,'query'),e=>e instanceof EmbeddingRequestError && e.category===category && e.status===status); assert.equal(sends,1); });
      }
      for (const stage of ['headers','body']) await t.test(`${provider} timeout at ${stage}`,async () => {
        sends=0; let close; const closed = new Promise(r=>close=r); reply=(_q,r)=>{r.on('close',close);if(stage==='body'){r.writeHead(200,{'content-type':'application/json'});r.write('{');}};
        const start=performance.now();await assert.rejects(ai().createEmbedding('q',provider,'query'),e=>e.category==='availability');
        assert.ok(performance.now()-start<2000);assert.equal(sends,1);await Promise.race([closed,new Promise((_,rej)=>{const tm=setTimeout(()=>rej(Error('HTTP not closed')),1500);tm.unref();})]);
      });
      await t.test(`${provider} invalid dimensions and malformed completed response`,async()=>{sends=0;reply=(_q,r)=>json(r,200,provider==='yandex'?{embedding:[1]}:{data:[{index:0,embedding:[1]}]});await assert.rejects(ai().createEmbedding('q',provider,'query'),e=>e.category==='invalid-response');assert.equal(sends,1);});
      await t.test(`${provider} connection reset is availability`,async()=>{sends=0;reply=(q,r)=>r.destroy();await assert.rejects(ai().createEmbedding('q',provider,'query'),e=>e.category==='availability');assert.equal(sends,1);});
      await t.test(`${provider} caller abort is not availability`,async()=>{sends=0;const c=new AbortController();reply=()=>c.abort(new Error('caller stopped'));await assert.rejects(ai().createEmbedding('q',provider,'query',{signal:c.signal}),e=>e===c.signal.reason);assert.equal(sends,1);});
      await t.test(`${provider} preabort sends zero`,async()=>{sends=0;const c=new AbortController();c.abort();await assert.rejects(ai().createEmbedding('q',provider,'query',{signal:c.signal}),e=>e===c.signal.reason);assert.equal(sends,0);});
      await t.test(`${provider} success after outage on the same service`,async()=>{sends=0;const service=ai();reply=(_q,r)=>json(r,503,{error:{code:'unavailable'}});await assert.rejects(service.createEmbedding('q',provider,'query'));reply=(_q,r)=>json(r,200,provider==='yandex'?{embedding:['1','2']}:{data:[{index:0,embedding:[1,2]}]});assert.deepEqual(await service.createEmbedding('q',provider,'query'),[1,2]);assert.equal(sends,2);});
    }
  } finally {globalThis.fetch=native;for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});
