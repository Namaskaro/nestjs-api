import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { initializeCampaign, readCampaign } from './live-ai-budget.mjs';
import { createCampaignTransport, loadPolzaRoute } from './live-ai-http.mjs';

const messages = [{ role: 'user', content: 'Синтетический отзыв' }];
const config = {
  yandex: {
    key: 'offline-key', model: 'gpt://offline/yandexgpt-5.1', dimensions: 768,
    doc: 'emb://offline/text-embeddings-v2-doc/latest', query: 'emb://offline/text-embeddings-v2-query/latest',
  },
  openai: { key: 'offline-key', model: 'gpt-6.1-sol' },
  polza: { key: 'offline-key', model: 'qwen/qwen3.8-max' },
};
const polzaRoute = {
  name: 'alibaba',
  parameters: ['max_completion_tokens'],
  tariff: { inputNanoRubPerToken: 300_000, outputNanoRubPerToken: 720_000, source: 'offline fixture' },
};
const fixture = (t, fetchImpl, route) => {
  const dir = mkdtempSync(join(tmpdir(), 'review-live-ai-http-'));
  t.after(() => {
    for (const name of readdirSync(dir)) unlinkSync(join(dir, name));
    rmdirSync(dir);
  });
  const journal = join(dir, 'campaign.json');
  initializeCampaign(journal);
  let calls = 0;
  const transport = createCampaignTransport({ config, journal, polzaRoute: route,
    fetchImpl: (url, init) => {
      calls++;
      const entry = readCampaign(journal).calls.at(-1);
      assert.equal(entry.status, 'reserved');
      assert.ok(entry.reservedInputTokens > Buffer.byteLength(init.body));
      assert.equal(init.redirect, 'error');
      assert.equal(init.method, 'POST');
      return fetchImpl(url, JSON.parse(init.body), init.headers);
    },
  });
  return { journal, transport, calls: () => calls };
};

test('Yandex completion and embeddings use the configured API with explicit output and vector limits', async (t) => {
  const { transport, journal } = fixture(t, (url, body, headers) => {
    assert.equal(headers.authorization, 'Api-Key offline-key');
    assert.equal(headers['x-data-logging-enabled'], 'false');
    if (url.endsWith('/completion')) {
      assert.equal(url, 'https://ai.api.cloud.yandex.net/foundationModels/v1/completion');
      assert.deepEqual(body.completionOptions, {
        stream: false, temperature: 0, maxTokens: '140', reasoningOptions: { mode: 'DISABLED' },
      });
      assert.equal(body.modelUri, config.yandex.model);
      assert.deepEqual(body.messages[0], { role: 'user', text: messages[0].content });
      assert.equal(body.jsonObject, true);
      return Response.json({ result: {
        usage: { inputTextTokens: '12', completionTokens: '5', totalTokens: '17' },
        alternatives: [{ status: 'ALTERNATIVE_STATUS_FINAL', message: { text: '{}' } }],
      } });
    }
    assert.equal(url, 'https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding');
    assert.deepEqual(body, { modelUri: config.yandex.query, text: 'Вопрос', dim: '768' });
    return Response.json({ embedding: Array(768).fill('0.5'), numTokens: '7' });
  });
  assert.equal((await transport.generate('yandex', 'summary', messages, 140)).text, '{}');
  assert.equal((await transport.embed('embedding-query-1', 'Вопрос')).vector[0], 0.5);
  assert.deepEqual(readCampaign(journal).calls.map((entry) => entry.costNanoRub), [13_600_000, 70_700]);
});

test('OpenAI caps all generated tokens and records reasoning without double counting', async (t) => {
  const { transport, journal } = fixture(t, (url, body, headers) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(headers.authorization, 'Bearer offline-key');
    assert.deepEqual(body, {
      model: 'gpt-6.1-sol', input: [...messages, { role: 'user', content: 'Формат ответа: один JSON-объект без Markdown.' }],
      max_output_tokens: 180, service_tier: 'default', store: false, stream: false,
      reasoning: { effort: 'low' }, text: { format: { type: 'json_object' } },
    });
    return Response.json({ model: 'gpt-6.1-sol', status: 'completed', service_tier: 'default',
      output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{}' }] }],
      usage: { input_tokens: 25, output_tokens: 15, total_tokens: 40, output_tokens_details: { reasoning_tokens: 8 } },
    });
  });
  const result = await transport.generate('openai', 'qa-supported', messages, 180);
  assert.deepEqual(result.usage, { inputTokens: 25, outputTokens: 15, reasoningTokens: 8 });
  const restarted = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { readCampaign } from './infra/integration/live-ai-budget.mjs'; console.log(JSON.stringify(readCampaign(process.argv[1]).calls[0]));",
    journal], { encoding: 'utf8', windowsHide: true });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal(JSON.parse(restarted.stdout).reasoningTokens, 8);
});

test('Polza blocks unconfirmed routing before send and pins a supplied route without fallback', async (t) => {
  const blocked = fixture(t, () => assert.fail('Unexpected HTTP request'));
  await assert.rejects(blocked.transport.generate('polza', 'summary', messages, 200), /unconfirmed/);
  assert.equal(blocked.calls(), 0);
  const { transport, journal } = fixture(t, (url, body) => {
    assert.equal(url, 'https://polza.ai/api/v1/chat/completions');
    assert.equal(body.model, config.polza.model);
    assert.equal(body.max_completion_tokens, 190);
    assert.deepEqual(body.provider, { only: ['alibaba'], allow_fallbacks: false });
    assert.deepEqual(body.reasoning, { effort: 'minimal', exclude: true });
    assert.deepEqual(body.usage, { include: true });
    return Response.json({ model: config.polza.model,
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      usage: { prompt_tokens: 25, completion_tokens: 15, total_tokens: 40,
        completion_tokens_details: { reasoning_tokens: 8 }, cost: 0.01 },
    });
  }, polzaRoute);
  await transport.generate('polza', 'summary', messages, 200);
  assert.equal(readCampaign(journal).calls[0].reportedNanoRub, 10_000_000);
});

test('Polza catalog must confirm the pinned route, full output cap and ruble tariff', async () => {
  const catalog = (parameters) => async (url, options) => {
    assert.equal(url, 'https://api.polza.ai/v1/models/qwen/qwen3.8-max');
    assert.equal(options.headers, undefined);
    return Response.json({
      id: config.polza.model,
      providers: [{
        name: 'alibaba', supported_parameters: parameters, pricing: {
          currency: 'RUB', prompt_per_million: '238.08960000',
          input_cache_write_per_million: '297.61200000', completion_per_million: '714.26880000',
        },
      }],
    });
  };
  await assert.rejects(loadPolzaRoute(catalog(['max_tokens'])), /cap including all/);
  const route = await loadPolzaRoute(catalog(['max_completion_tokens']));
  assert.equal(route.tariff.inputNanoRubPerToken, 297_612);
  assert.equal(route.tariff.outputNanoRubPerToken, 714_269);
});

test('HTTP failure, redirect or inconsistent token totals cause no retry and retain reserve', async (t) => {
  for (const respond of [
    () => new Response(null, { status: 503 }),
    () => new Response(null, { status: 302 }),
    () => Response.json({ model: config.openai.model, status: 'completed',
      usage: { input_tokens: 25, output_tokens: 15, total_tokens: 39 } }),
  ]) {
    const { transport, calls, journal } = fixture(t, respond);
    await assert.rejects(transport.generate('openai', 'summary', messages, 100), /reconciled/);
    await assert.rejects(transport.generate('openai', 'qa-supported', messages, 100), /stopped/);
    assert.equal(calls(), 1);
    const [entry] = readCampaign(journal).calls;
    assert.equal(entry.status, 'uncertain');
    assert.equal(entry.costNanoRub, entry.reservedNanoRub);
  }
});

test('a budget breach prevents any network call', async (t) => {
  const { transport, calls } = fixture(t, () => assert.fail('Unexpected HTTP request'));
  await assert.rejects(transport.generate('openai', 'summary', messages, 4_001), /token limit/);
  assert.equal(calls(), 0);
});
