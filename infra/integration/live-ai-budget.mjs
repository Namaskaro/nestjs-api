import {
  closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const campaignJournal = fileURLToPath(
  new URL('../../.tmp/review-live-ai-campaign-v1.json', import.meta.url),
);

const campaign = 'review-intelligence-v2-live-ai-v1';
const providerBudget = 20_000_000_000; // nanorubles
const campaignBudget = 60_000_000_000;
const generationScenarios = new Set([
  'summary', 'qa-supported', 'qa-insufficient', 'recommend-evidence', 'recommend-no-evidence',
]);
const profiles = {
  yandex: /^gpt:\/\/[^/]+\/yandexgpt-5\.1$/,
  openai: /^gpt-6\.1-sol$/,
  polza: /^qwen\/qwen3\.8-max$/,
};
const embeddingScenario = /^embedding-(doc-(?:[1-9]|1[0-2])|query-[1-5])$/;
const embeddingModels = {
  doc: /^emb:\/\/[^/]+\/text-embeddings-v2-doc\/latest$/,
  query: /^emb:\/\/[^/]+\/text-embeddings-v2-query\/latest$/,
};

const count = (value) => Number.isSafeInteger(value) && value >= 0;
const sum = (entries, field) => entries.reduce((total, entry) => total + entry[field], 0);
const validCost = (value) => count(value) && value > 0;

function writeAndSync(path, state) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Call once, after reconciling any work already done in this campaign.
export function initializeCampaign(journal = campaignJournal) {
  writeAndSync(journal, { campaign, calls: [], stopped: {} });
}

function save(journal, state) {
  const temporary = `${journal}.${randomUUID()}.tmp`;
  writeAndSync(temporary, state);
  renameSync(temporary, journal);
}

export function readCampaign(journal = campaignJournal) {
  const state = JSON.parse(readFileSync(journal, 'utf8'));
  if (
    state.campaign !== campaign || !Array.isArray(state.calls)
    || !state.stopped || typeof state.stopped !== 'object'
    || state.calls.some((call) => !Object.hasOwn(profiles, call.provider)
      || !['reserved', 'settled', 'uncertain'].includes(call.status)
      || ![call.costNanoRub, call.inputTokens, call.outputTokens].every(count))
  ) {
    throw new Error('Invalid Live AI campaign journal');
  }
  return state;
}

// The caller must verify account isolation, the effective tariff and the token
// bound before calling. send must issue one request, without retries or fallback.
// It must apply the reserved maxOutputTokens on the wire and return normalized
// provider usage, including billable reasoning tokens.
export async function withReservedCall(request, send, journal = campaignJournal) {
  const { provider, scenario, model, maxInputTokens, maxOutputTokens, tariff } = request;
  if (!Object.hasOwn(profiles, provider)) throw new Error('Unknown Live AI provider');
  const lock = `${journal}.lock`;
  const fd = openSync(lock, 'wx', 0o600);
  try {
    const state = readCampaign(journal);
    if (state.calls.some((call) => call.status === 'reserved')) {
      throw new Error('Unreconciled Live AI reservation');
    }
    if (state.stopped[provider]) throw new Error(`Live AI provider stopped: ${state.stopped[provider]}`);

    function stop(reason) {
      state.stopped[provider] = reason;
      save(journal, state);
      throw new Error(reason);
    }

    const embedding = embeddingScenario.exec(scenario);
    const kind = embedding ? 'embedding' : 'generation';
    const modelPattern = embedding
      ? embeddingModels[embedding[1].split('-')[0]]
      : profiles[provider];
    if (
      (embedding ? provider !== 'yandex' : !generationScenarios.has(scenario))
      || typeof model !== 'string' || !modelPattern.test(model)
      || state.calls.some((call) => call.provider === provider && call.scenario === scenario)
    ) stop('Unexpected Live AI scenario or model');

    const inputRate = tariff?.inputNanoRubPerToken;
    const outputRate = tariff?.outputNanoRubPerToken;
    if (
      !validCost(maxInputTokens) || !count(maxOutputTokens)
      || !validCost(inputRate) || !count(outputRate)
      || (embedding ? maxOutputTokens !== 0 || outputRate !== 0 : !maxOutputTokens || !outputRate)
      || typeof tariff.source !== 'string' || !tariff.source.trim()
      || typeof send !== 'function'
    ) stop('Unconfirmed Live AI token bound or tariff');

    const prior = state.calls.filter((call) => call.provider === provider);
    const generations = prior.filter((call) => call.kind === 'generation');
    if (
      embedding ? state.calls.filter((call) => call.kind === 'embedding').length >= 17
        : generations.length >= 5
          || sum(generations, 'inputTokens') + maxInputTokens > 20_000
          || sum(generations, 'outputTokens') + maxOutputTokens > 4_000
    ) stop('Live AI call or token limit reached');

    const reserve = maxInputTokens * inputRate + maxOutputTokens * outputRate;
    if (
      !validCost(reserve) || sum(prior, 'costNanoRub') + reserve > providerBudget
      || sum(state.calls, 'costNanoRub') + reserve > campaignBudget
    ) stop('Live AI budget cannot cover the next request');

    const entry = {
      provider, scenario, kind, model, status: 'reserved',
      tariff: { inputNanoRubPerToken: inputRate, outputNanoRubPerToken: outputRate, source: tariff.source },
      reservedInputTokens: maxInputTokens, reservedOutputTokens: maxOutputTokens,
      reservedNanoRub: reserve, costNanoRub: reserve,
      inputTokens: maxInputTokens, outputTokens: maxOutputTokens,
    };
    state.calls.push(entry);
    save(journal, state);

    let result;
    try {
      result = await send(Object.freeze({ model, maxOutputTokens }));
      const { inputTokens, outputTokens, reasoningTokens } = result?.usage ?? {};
      if (
        !validCost(inputTokens) || !count(outputTokens)
        || inputTokens > maxInputTokens || outputTokens > maxOutputTokens
        || (reasoningTokens !== undefined && (!count(reasoningTokens) || reasoningTokens > outputTokens))
      ) throw new Error('Invalid usage');
      Object.assign(entry, {
        status: 'settled', inputTokens, outputTokens, reasoningTokens,
        ...(typeof result.text === 'string' ? { text: result.text } : {}),
        ...(typeof result.completed === 'boolean' ? { completed: result.completed } : {}),
        ...(typeof result.reportedNanoRub === 'number' ? { reportedNanoRub: result.reportedNanoRub } : {}),
        costNanoRub: inputTokens * inputRate + outputTokens * outputRate,
      });
      if (result.reportedNanoRub !== undefined && (
        !count(result.reportedNanoRub) || result.reportedNanoRub > entry.costNanoRub
      )) throw new Error('Unexpected provider charge');
    } catch (error) {
      entry.status = 'uncertain';
      entry.costNanoRub = Math.max(reserve, count(result?.reportedNanoRub) ? result.reportedNanoRub : 0);
      if (Number.isInteger(error?.httpStatus)) entry.httpStatus = error.httpStatus;
      stop('Live AI transport or usage could not be reconciled');
    }
    save(journal, state);
    return result;
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
