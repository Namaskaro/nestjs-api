import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { withReservedCall } from './live-ai-budget.mjs';

const yandexBase = 'https://ai.api.cloud.yandex.net/foundationModels/v1';
const openaiBase = 'https://api.openai.com/v1';
const polzaBase = 'https://polza.ai/api/v1';
const openaiModel = 'gpt-6.1-sol';
const polzaModel = 'qwen/qwen3.8-max';

const token = (value) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0;
const reserveRate = (input, output, source) => ({
  inputNanoRubPerToken: input, outputNanoRubPerToken: output, source,
});

// Reading the chosen dotenv file never populates process.env or loads an app.
export function loadProviderConfig(path) {
  const source = path ? parseEnv(readFileSync(path, 'utf8')) : {};
  const value = (name) => process.env[name] ?? source[name];
  const folder = value('YANDEX_FOLDER_ID');
  const yandexModel = value('YANDEX_MODEL');
  const doc = value('YANDEX_EMBEDDING_DOCUMENT_MODEL');
  const query = value('YANDEX_EMBEDDING_QUERY_MODEL');
  const polzaUrl = value('POLZA_BASE_URL')?.replace(/\/$/, '');
  return {
    yandex: {
      key: value('YANDEX_API_KEY'),
      model: /^[a-z0-9]+$/i.test(folder ?? '') && yandexModel === `gpt://${folder}/yandexgpt-5.1` ? yandexModel : undefined,
      doc: doc === `emb://${folder}/text-embeddings-v2-doc/latest` ? doc : undefined,
      query: query === `emb://${folder}/text-embeddings-v2-query/latest` ? query : undefined,
      dimensions: Number(value('YANDEX_EMBEDDING_DIMENSIONS')),
    },
    openai: { key: value('OPENAI_API_KEY'), model: openaiModel },
    polza: { key: value('POLZA_API_KEY'), model: !polzaUrl || polzaUrl === polzaBase ? polzaModel : undefined },
  };
}

export async function loadPolzaRoute(fetchImpl = fetch) {
  const url = `https://api.polza.ai/v1/models/${polzaModel}`;
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Could not verify Polza model catalog');
  const catalog = await response.json();
  const model = catalog.data ?? catalog;
  const route = (model.providers ?? [model.top_provider]).find((entry) => entry?.name === 'alibaba');
  const pricing = route?.pricing;
  const parameters = route?.supported_parameters;
  if (model.id !== polzaModel || pricing?.currency !== 'RUB' || !parameters?.includes('max_completion_tokens')) {
    throw new Error('Polza has not confirmed a cap including all Qwen output tokens');
  }
  const price = (key) => {
    const amount = Number(pricing[key]);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Unconfirmed Polza tariff');
    return Math.ceil(amount * 1000); // RUB / 1M to nanorubles / token
  };
  return {
    name: route.name, parameters,
    tariff: reserveRate(Math.max(price('prompt_per_million'), price('input_cache_write_per_million')),
      price('completion_per_million'), url),
  };
}

function decodeUsage(input, output, total, reasoning) {
  const inputTokens = token(input);
  const outputTokens = token(output);
  const reasoningTokens = token(reasoning);
  if (!safeCount(inputTokens) || !safeCount(outputTokens)
    || token(total) !== inputTokens + outputTokens
    || (reasoningTokens !== undefined && (!safeCount(reasoningTokens) || reasoningTokens > outputTokens))) {
    throw new Error('Provider token totals are inconsistent');
  }
  return { inputTokens, outputTokens, reasoningTokens };
}

function decodeGeneration(provider, model, body) {
  if (provider === 'yandex') {
    const { result } = body;
    const usage = result?.usage;
    const row = result?.alternatives?.[0];
    return {
      usage: decodeUsage(usage?.inputTextTokens, usage?.completionTokens, usage?.totalTokens,
        usage?.completionTokensDetails?.reasoningTokens),
      text: row?.message?.text,
      completed: row?.status === 'ALTERNATIVE_STATUS_FINAL',
    };
  }
  if (body.model !== model && !(provider === 'openai' && body.model?.startsWith(`${model}-`))) {
    throw new Error('Unexpected model in provider response');
  }
  const { usage } = body;
  if (provider === 'openai') {
    if (body.service_tier && body.service_tier !== 'default') throw new Error('Unexpected OpenAI service tier');
    return {
      usage: decodeUsage(usage?.input_tokens, usage?.output_tokens, usage?.total_tokens,
        usage?.output_tokens_details?.reasoning_tokens),
      text: body.output?.flatMap((item) => item.type === 'message'
        ? item.content.filter((part) => part.type === 'output_text').map((part) => part.text) : []).join(''),
      completed: body.status === 'completed',
    };
  }
  const row = body.choices?.[0];
  return {
    usage: decodeUsage(usage?.prompt_tokens, usage?.completion_tokens, usage?.total_tokens,
      usage?.completion_tokens_details?.reasoning_tokens),
    text: row?.message?.content,
    completed: row?.finish_reason === 'stop',
    ...(typeof usage?.cost === 'number' && { reportedNanoRub: Math.ceil(usage.cost * 1e9) }),
  };
}

function generationRequest(provider, model, messages, maxOutputTokens, route) {
  switch (provider) {
    case 'yandex':
      return {
        url: `${yandexBase}/completion`,
        body: {
          modelUri: model,
          completionOptions: {
            stream: false, temperature: 0, maxTokens: String(maxOutputTokens),
            reasoningOptions: { mode: 'DISABLED' },
          },
          messages: messages.map(({ role, content }) => ({ role, text: content })),
          jsonObject: true,
        },
      };
    case 'openai':
      return {
        url: `${openaiBase}/responses`,
        body: {
          model, input: messages, max_output_tokens: maxOutputTokens, service_tier: 'default',
          store: false, stream: false, reasoning: { effort: 'low' },
          text: { format: { type: 'json_object' } },
        },
      };
    case 'polza':
      return {
        url: `${polzaBase}/chat/completions`,
        body: {
          // Alibaba documents up to ten extra tokens beyond its API cap.
          model, messages, max_completion_tokens: maxOutputTokens - 10, stream: false, temperature: 0,
          provider: { only: [route], allow_fallbacks: false },
          reasoning: { effort: 'minimal', exclude: true },
          response_format: { type: 'json_object' },
          usage: { include: true },
        },
      };
  }
}

export function createCampaignTransport({
  config, journal, fetchImpl = fetch, polzaRoute,
}) {
  async function post(provider, url, body, signal) {
    const key = config[provider]?.key;
    const yandex = provider === 'yandex';
    const timeout = AbortSignal.timeout(60_000);
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        'content-type': 'application/json',
        authorization: `${yandex ? 'Api-Key' : 'Bearer'} ${key}`,
        ...(yandex ? { 'x-data-logging-enabled': 'false' } : {}),
      },
      body,
    });
    if (!response.ok) throw Object.assign(new Error('Live AI HTTP request failed'), { httpStatus: response.status });
    return response.json();
  }

  function ready(provider) {
    const profile = config[provider];
    if (!profile?.key || !profile.model) throw new Error(`Missing confirmed ${provider} model or local key`);
    return profile;
  }

  return {
    async generate(provider, scenario, input, maxOutputTokens, signal) {
      const { model } = ready(provider);
      if (provider === 'polza' && (!polzaRoute?.parameters?.includes('max_completion_tokens')
        || polzaRoute.name !== 'alibaba' || maxOutputTokens <= 10)) {
        throw new Error('Polza tariff and total output cap are unconfirmed');
      }
      const messages = [...input, { role: 'user', content: 'Формат ответа: один JSON-объект без Markdown.' }];
      const { url, body } = generationRequest(provider, model, messages, maxOutputTokens, polzaRoute?.name);
      const serialized = JSON.stringify(body);
      const tariff = provider === 'yandex' ? reserveRate(800_000, 800_000, 'Yandex synchronous RUB incl. VAT')
        // $5/M worst published cache write, $10/M output, 100 RUB/USD plus 30% headroom.
        : provider === 'openai' ? reserveRate(650_000, 1_300_000, 'OpenAI Standard at 100 RUB/USD + 30%')
        : polzaRoute.tariff;
      // Only text and fixed JSON fields are sent. Use serialized UTF-8 bytes plus
      // message overhead, with no files, tools, history, external schema or retrieval.
      const maxInputTokens = Buffer.byteLength(serialized) + 256;
      signal?.throwIfAborted();
      return withReservedCall({ provider, scenario, model, maxInputTokens, maxOutputTokens, tariff },
        async () => decodeGeneration(provider, model, await post(provider, url, serialized, signal)), journal);
    },
    async embed(scenario, text, signal) {
      const { doc, query, dimensions } = ready('yandex');
      const model = scenario.startsWith('embedding-doc-') ? doc : query;
      if (!model || dimensions !== 768) throw new Error('Unconfirmed Yandex embedding space');
      const body = JSON.stringify({ modelUri: model, text, dim: String(dimensions) });
      signal?.throwIfAborted();
      return withReservedCall({
        provider: 'yandex', scenario, model, maxInputTokens: Buffer.byteLength(body) + 32,
        maxOutputTokens: 0, tariff: reserveRate(10_100, 0, 'Yandex embedding RUB incl. VAT'),
      }, async () => {
        const response = await post('yandex', `${yandexBase}/textEmbedding`, body, signal);
        const vector = response.embedding?.map((value) => typeof value === 'string' && value.trim() ? Number(value) : value);
        if (vector?.length !== dimensions || !vector.every(Number.isFinite)) throw new Error('Invalid Yandex vector');
        return { vector, usage: { inputTokens: token(response.numTokens), outputTokens: 0 } };
      }, journal);
    },
  };
}
