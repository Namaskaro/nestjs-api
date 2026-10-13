import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { AiService } from './ai.service';
import { RequestRouterModelSchema } from '../support-agent/schemas/request-router.schema';
import { ProductRecommendationSynthesisSchema } from '../product-consultation/application/recommendation/product-recommendation-synthesizer';
import { createConsultationAgent } from '../product-consultation/application/consultation-agent/consultation.agent';
import { createCustomerHelpAgent } from '../support-agent/agents/customer-help-agent/customer-help.agent';
import type { StoreKnowledgeService } from '../store-knowledge/store-knowledge.service';

// Opt-in only. Uses the pinned Docker gateway and mock upstream in an isolated
// local test network. No real credentials, application bootstrap or paid calls.
const integration =
  process.env.RUN_LITELLM_INTEGRATION === '1' ? describe : describe.skip;
const control = 'http://127.0.0.1:34180';
type Provider = 'yandex' | 'openai';
type Role = 'FAST' | 'STANDARD';
const schema = z.object({ value: z.string() }).strict();
const valid = { value: 'offline result' };
const deployments = (['yandex', 'openai'] as const).flatMap((provider) =>
  (['FAST', 'STANDARD'] as const).map((role) => ({ provider, role })),
);

function ai(provider: Provider, extra: Record<string, string> = {}) {
  const values: Record<string, string> = {
    CHAT_MODE: 'gateway',
    EMBEDDING_PROVIDER: 'yandex',
    LITELLM_BASE_URL: `http://127.0.0.1:${
      provider === 'yandex' ? 34181 : 34182
    }/v1`,
    LITELLM_API_KEY: 'sk-offline-gateway',
    ...extra,
  };
  return new AiService({ get: (key: string) => values[key] } as ConfigService);
}

function envelope(
  provider: Provider,
  text?: string,
  args = JSON.stringify(valid),
  name = 'emit',
  incomplete = false,
) {
  return provider === 'yandex'
    ? {
        id: `cc_${text === undefined ? 'tool' : 'text'}`,
        object: 'chat.completion',
        created: 1,
        model: 'upstream',
        choices: [
          {
            index: 0,
            finish_reason: incomplete
              ? 'length'
              : text === undefined
              ? 'tool_calls'
              : 'stop',
            message: {
              role: 'assistant',
              content: text ?? null,
              ...(text === undefined
                ? {
                    tool_calls: [
                      {
                        id: 'call_test',
                        type: 'function',
                        function: { name, arguments: args },
                      },
                    ],
                  }
                : {}),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }
    : {
        id: `resp_${text === undefined ? 'tool' : 'text'}`,
        object: 'response',
        created_at: 1,
        model: 'upstream',
        status: incomplete ? 'incomplete' : 'completed',
        error: null,
        incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
        output:
          text === undefined
            ? [
                {
                  type: 'reasoning',
                  id: 'rs_test',
                  summary: [],
                  encrypted_content: 'offline-encrypted',
                },
                {
                  type: 'function_call',
                  id: 'fc_test',
                  call_id: 'call_test',
                  status: 'completed',
                  name,
                  arguments: args,
                },
              ]
            : [
                {
                  type: 'message',
                  id: 'msg_test',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'output_text', text, annotations: [] }],
                },
              ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 1 },
        },
      };
}

async function fixture(...bodies: unknown[]) {
  const response = await fetch(`${control}/fixtures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ replies: bodies.map((body) => ({ body })) }),
  });
  if (!response.ok) throw new Error('Mock control unavailable');
}
async function state(): Promise<{
  requests: Array<{ path: string; body: any }>;
  events: any[];
}> {
  return (await fetch(`${control}/requests`)).json();
}

integration('real LiteLLM 1.100.3 + LangChain + mock providers', () => {
  let log: jest.SpyInstance;
  beforeAll(async () => {
    const ready = await (await fetch(`${control}/ready`)).json();
    expect(ready).toEqual({ ready: true, version: '1.100.3' });
  });
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      LANGSMITH_TRACING: 'false',
      LANGCHAIN_TRACING_V2: 'false',
    });
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(deployments)(
    '$provider $role preserves function output, aliases and physical-attempt accounting',
    async ({ provider, role }) => {
      await fixture(envelope(provider));
      const model = ai(provider).getChatModel(role);
      const result = await model
        .withStructuredOutput(schema, {
          name: 'emit',
          method: 'functionCalling',
          strict: false,
          includeRaw: true,
        })
        .invoke('Return a result.');
      expect(result.parsed).toEqual(valid);
      expect(result.raw.tool_calls?.[0].args).toEqual(valid);
      const observed = await state();
      expect(observed.requests).toHaveLength(1);
      const upstream = observed.requests[0];
      expect(upstream.path).toBe(
        provider === 'yandex' ? '/v1/chat/completions' : '/v1/responses',
      );
      if (provider === 'yandex') {
        expect(upstream.body.model).toContain('gpt://offline/');
        expect(upstream.body).not.toHaveProperty('reasoning_effort');
        expect(upstream.body.tools[0].function.strict).toBe(false);
      } else {
        expect(upstream.body.model).toBe(
          role === 'FAST' ? 'gpt-6-luna' : 'gpt-6.1-sol',
        );
        expect(upstream.body.reasoning.effort).toBe(
          role === 'FAST' ? 'none' : 'medium',
        );
        expect(upstream.body.tools[0].strict).toBe(false);
        if (role === 'STANDARD')
          expect(upstream.body).not.toHaveProperty('temperature');
      }
      const terminal = observed.events.filter(
        (event) => event.status !== 'started',
      );
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toMatchObject({
        actualProvider: provider,
        status: 'success',
        totalTokens: 15,
        durationMs: expect.any(Number),
      });
      const logs = log.mock.calls.map(([line]) => JSON.parse(line));
      const gateway = logs.find(
        (event) => event.event === 'llm_gateway_request',
      );
      expect(gateway).toMatchObject({
        alias: role === 'FAST' ? 'support-fast' : 'support-standard',
        actualProvider: provider,
        retries: 0,
        fallbacks: 0,
      });
      expect(gateway.costUsd).toBeNull();
      expect(terminal[0].costUsd).toBeNull();
      expect(gateway.gatewayRequestId).toBe(terminal[0].gatewayRequestId);
      expect(logs.filter((event) => event.event === 'llm_call')).toHaveLength(
        1,
      );
      expect(logs.find((event) => event.event === 'llm_call')).toMatchObject({
        usageScope: 'logical_call',
        responseId: gateway.responseId,
      });
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s preserves stateless tool history',
    async (provider) => {
      await fixture(envelope(provider), envelope(provider, 'Done.'));
      const model = ai(provider)
        .getChatModel('STANDARD')
        .bindTools([{ name: 'emit', description: 'Test', schema }]);
      const user = new HumanMessage('Use the tool.');
      const first = await model.invoke([user]);
      const final = await model.invoke([
        user,
        first,
        new ToolMessage({
          tool_call_id: first.tool_calls![0].id!,
          content: 'Tool result',
        }),
      ]);
      expect(final.text).toBe('Done.');
      const observed = await state();
      expect(observed.requests).toHaveLength(2);
      const body = observed.requests[1].body;
      if (provider === 'yandex')
        expect(body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'tool',
              tool_call_id: 'call_test',
              content: 'Tool result',
            }),
          ]),
        );
      else
        expect(body.input).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'reasoning',
              encrypted_content: 'offline-encrypted',
            }),
            expect.objectContaining({
              type: 'function_call_output',
              call_id: 'call_test',
              output: 'Tool result',
            }),
          ]),
        );
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s correlates concurrent calls on the same cached model independently',
    async (provider) => {
      const first = {
        ...envelope(provider, 'First.'),
        id: 'resp_concurrent_first',
      };
      const second = {
        ...envelope(provider, 'Second.'),
        id: 'resp_concurrent_second',
      };
      await fixture(first, second);
      const model = ai(provider).getChatModel('STANDARD');
      const output = await Promise.all([
        model.invoke('First'),
        model.invoke('Second'),
      ]);
      expect(output.map((message) => message.text).sort()).toEqual([
        'First.',
        'Second.',
      ]);
      const terminal = (await state()).events.filter(
        (event) => event.status !== 'started',
      );
      const logs = log.mock.calls.map(([line]) => JSON.parse(line));
      const gateway = logs.filter(
        (event) => event.event === 'llm_gateway_request',
      );
      const logical = logs.filter((event) => event.event === 'llm_call');
      expect(terminal).toHaveLength(2);
      expect(gateway).toHaveLength(2);
      expect(logical).toHaveLength(2);
      expect(new Set(gateway.map((event) => event.gatewayRequestId)).size).toBe(
        2,
      );
      expect(terminal.map((event) => event.gatewayRequestId).sort()).toEqual(
        gateway.map((event) => event.gatewayRequestId).sort(),
      );
      expect(logical.map((event) => event.responseId).sort()).toEqual(
        gateway.map((event) => event.responseId).sort(),
      );
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s never turns a refusal into a parsed result',
    async (provider) => {
      const refusal =
        provider === 'yandex'
          ? {
              ...envelope(provider, ''),
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: null,
                    refusal: 'Offline refusal',
                  },
                },
              ],
            }
          : {
              ...envelope(provider, ''),
              output: [
                {
                  type: 'message',
                  id: 'msg_refusal',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'refusal', refusal: 'Offline refusal' }],
                },
              ],
            };
      await fixture(refusal);
      const result = await ai(provider)
        .getChatModel('STANDARD')
        .withStructuredOutput(schema, {
          method: 'functionCalling',
          name: 'emit',
          includeRaw: true,
        })
        .invoke('Return a result.');
      expect(result.parsed == null).toBe(true);
      expect(result.raw.tool_calls).toHaveLength(0);
      if (provider === 'openai')
        expect(result.raw.additional_kwargs.refusal).toBe('Offline refusal');
      expect((await state()).requests).toHaveLength(1);
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s rejects an incomplete tool call even when its arguments are valid',
    async (provider) => {
      await fixture(envelope(provider, undefined, undefined, undefined, true));
      await expect(
        ai(provider)
          .getChatModel('STANDARD')
          .withStructuredOutput(schema, {
            method: 'functionCalling',
            name: 'emit',
            includeRaw: true,
          })
          .invoke('Return a result.'),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ name: 'ChatTransportError' }),
      });
      expect((await state()).requests).toHaveLength(1);
    },
    20000,
  );

  it('rejects an unknown Yandex finish reason before the bridge can mark it completed', async () => {
    const response = {
      ...envelope('yandex', JSON.stringify(valid)),
      choices: [
        {
          index: 0,
          finish_reason: 'unknown',
          message: { role: 'assistant', content: JSON.stringify(valid) },
        },
      ],
    };
    await fixture(response);
    await expect(
      ai('yandex')
        .getChatModel('STANDARD')
        .withStructuredOutput(schema, { method: 'jsonMode', includeRaw: true })
        .invoke('Return JSON.'),
    ).rejects.toMatchObject({ status: 502 });
    expect((await state()).requests).toHaveLength(1);
  }, 20000);

  it.each(['yandex', 'openai'] as const)(
    '%s rejects schema-valid incomplete JSON before parsing',
    async (provider) => {
      await fixture(
        envelope(provider, JSON.stringify(valid), undefined, undefined, true),
      );
      await expect(
        ai(provider)
          .getChatModel('STANDARD')
          .withStructuredOutput(schema, {
            method: 'jsonMode',
            includeRaw: true,
          })
          .invoke('Return JSON.'),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ name: 'ChatTransportError' }),
      });
      expect((await state()).requests).toHaveLength(1);
      expect(
        log.mock.calls
          .map(([line]) => JSON.parse(line))
          .filter(
            (event) => event.event === 'llm_call' && event.status === 'success',
          ),
      ).toHaveLength(0);
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s preserves the actual Router schema through default structured output',
    async (provider) => {
      const output = {
        workerQueries: {
          productAgent: null,
          orderAgent: null,
          customerHelpAgent: 'Доставка',
        },
        orderRequest: null,
        fallbackRoute: null,
        clarificationTopic: null,
        handoffRequest: null,
        reason: 'Store policy',
      };
      await fixture(envelope(provider, JSON.stringify(output)));
      const result = await ai(provider)
        .getChatModel('FAST')
        .withStructuredOutput(RequestRouterModelSchema, { includeRaw: true })
        .invoke('Return JSON.');
      expect(result.parsed).toEqual(output);
      const body = (await state()).requests[0].body;
      const format =
        provider === 'yandex'
          ? body.response_format.json_schema
          : body.text.format;
      expect(format.strict).toBe(true);
      expect(format.schema.properties.workerQueries.type).toBe('object');
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s preserves JSON mode and never falls back on Zod validation failure',
    async (provider) => {
      const valid = { message: 'Подходит.', recommendedPosition: 1 };
      await fixture(
        envelope(provider, JSON.stringify(valid)),
        envelope(
          provider,
          JSON.stringify({ ...valid, recommendedPosition: 0 }),
        ),
      );
      const model = ai(provider)
        .getChatModel('STANDARD')
        .withStructuredOutput(ProductRecommendationSynthesisSchema, {
          method: 'jsonMode',
        });
      await expect(model.invoke('Return JSON.')).resolves.toEqual(valid);
      await expect(model.invoke('Return JSON.')).rejects.toThrow();
      const observed = await state();
      expect(observed.requests).toHaveLength(2);
      expect(
        observed.events.filter((event) => event.status !== 'started'),
      ).toHaveLength(2);
      const body = observed.requests[0].body;
      expect(
        provider === 'yandex' ? body.response_format : body.text.format,
      ).toEqual({ type: 'json_object' });
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s keeps malformed raw tool arguments available without parsed success',
    async (provider) => {
      await fixture(envelope(provider, undefined, '{broken'));
      const result = await ai(provider)
        .getChatModel('STANDARD')
        .withStructuredOutput(schema, {
          method: 'functionCalling',
          name: 'emit',
          includeRaw: true,
        })
        .invoke('Return a result.');
      expect(result.parsed == null).toBe(true);
      expect(result.raw.invalid_tool_calls?.[0].args).toBe('{broken');
      expect((await state()).requests).toHaveLength(1);
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s preserves workspace raw-output normalization and its existing repair',
    async (provider) => {
      const plan = {
        operations: [
          {
            target: { kind: 'current', view: 'results' },
            decision: { action: 'SHOW_RESULTS', selection: { kind: 'active' } },
            view: 'results',
          },
        ],
      };
      await fixture(
        envelope(provider, undefined, '{broken', 'product_workspace_decision'),
        envelope(
          provider,
          undefined,
          JSON.stringify(plan),
          'product_workspace_decision',
        ),
      );
      const result = await createConsultationAgent(
        ai(provider),
      ).decideWorkspace({ currentMessage: 'Покажи найденное' });
      expect(result.operations[0]).toMatchObject({
        kind: 'consult',
        query: 'Покажи найденное',
        actions: [
          {
            decision: { proposal: { action: 'SHOW_RESULTS' } },
            view: 'results',
          },
        ],
      });
      expect((await state()).requests).toHaveLength(2);
    },
    20000,
  );

  it.each(['yandex', 'openai'] as const)(
    '%s propagates provider 503 with exactly one upstream attempt',
    async (provider) => {
      await fetch(`${control}/fixtures`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          replies: [
            {
              status: 503,
              body: {
                error: {
                  message: 'Offline unavailable',
                  type: 'service_unavailable',
                  code: 'unavailable',
                },
              },
            },
          ],
        }),
      });
      await expect(
        ai(provider).getChatModel('STANDARD').invoke('Hello'),
      ).rejects.toMatchObject({ status: 503 });
      const observed = await state();
      expect(observed.requests).toHaveLength(1);
      expect(
        observed.events.filter((event) => event.status === 'error'),
      ).toHaveLength(1);
      expect(
        observed.events.filter((event) => event.status === 'success'),
      ).toHaveLength(0);
    },
    20000,
  );

  it.each([
    { model: 'unapproved-model' },
    { fallbacks: ['gpt-6.1-sol'] },
    { num_retries: 3 },
    { api_base: 'https://unapproved.invalid/v1' },
    { reasoning: { effort: 'medium' } },
    { tools: [{ type: 'web_search' }] },
    { previous_response_id: 'resp_unknown' },
    { stream: true },
  ])(
    'rejects an unapproved request before upstream HTTP: %j',
    async (extra) => {
      await fixture();
      const response = await fetch('http://127.0.0.1:34181/v1/responses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer sk-offline-gateway',
        },
        body: JSON.stringify({
          model: 'support-standard',
          input: 'Hello',
          ...extra,
        }),
      });
      // LiteLLM's own auth rejects an api_base override before our policy hook.
      expect(response.status).toBe('api_base' in extra ? 401 : 400);
      expect((await state()).requests).toHaveLength(0);
    },
    20000,
  );

  it('keeps Yandex /v1/chat/completions available and rejects unverified reverse bridging to Sol', async () => {
    await fixture(envelope('yandex', 'Done.'));
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-offline-gateway',
      },
      body: JSON.stringify({
        model: 'support-standard',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    };
    const yandex = await fetch(
      'http://127.0.0.1:34181/v1/chat/completions',
      init,
    );
    expect(yandex.status).toBe(200);
    expect((await yandex.json()).choices[0].message.content).toBe('Done.');
    const sol = await fetch('http://127.0.0.1:34182/v1/chat/completions', init);
    expect(sol.status).toBe(400);
    expect((await state()).requests).toHaveLength(1);
  }, 20000);

  it('rejects client retry header overrides before contacting a provider', async () => {
    await fixture();
    const response = await fetch('http://127.0.0.1:34181/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-offline-gateway',
        'x-litellm-num-retries': '3',
      },
      body: JSON.stringify({ model: 'support-standard', input: 'Hello' }),
    });
    expect(response.status).toBe(400);
    expect((await state()).requests).toHaveLength(0);
  }, 20000);

  it.each(['yandex', 'openai'] as const)(
    '%s preserves graph v3 events and tool loop using completed HTTP responses',
    async (provider) => {
      await fixture(
        envelope(
          provider,
          undefined,
          JSON.stringify({ query: 'Доставка' }),
          'search_knowledge',
        ),
        envelope(provider, 'Доставка курьером.'),
      );
      const search = jest.fn(async () => 'Доставка курьером.');
      const graph = createCustomerHelpAgent(ai(provider), {
        search,
      } as unknown as StoreKnowledgeService);
      const events = [];
      for await (const event of await graph.streamEvents(
        { messages: [new HumanMessage('Доставка')] },
        { version: 'v3' },
      ))
        events.push(event);
      expect(JSON.stringify(events)).toContain('Доставка курьером.');
      expect(search).toHaveBeenCalledTimes(1);
      const observed = await state();
      expect(observed.requests).toHaveLength(2);
      expect(
        observed.events.filter((event) => event.status !== 'started'),
      ).toHaveLength(2);
      for (const request of observed.requests)
        expect(request.body.stream).not.toBe(true);
    },
    20000,
  );

  const budgetTest =
    process.env.RUN_LITELLM_BUDGET_INTEGRATION === '1' ? it : it.skip;
  budgetTest(
    'persists a scoped virtual key, records synthetic spend and blocks a sequential call after its budget',
    async () => {
      const baseURL = 'http://127.0.0.1:34183';
      const headers = {
        'content-type': 'application/json',
        authorization: 'Bearer sk-offline-gateway',
      };
      // Synthetic prices/budget for this disposable database test only.
      const generated = await fetch(`${baseURL}/key/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          models: ['support-standard'],
          max_budget: 0.015,
          budget_duration: '30d',
        }),
      });
      expect(generated.status).toBe(200);
      const { key } = await generated.json();
      expect(typeof key).toBe('string');
      await fixture();
      const forbidden = await fetch(`${baseURL}/v1/responses`, {
        method: 'POST',
        headers: { ...headers, authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'support-fast', input: 'Hello' }),
      });
      expect(forbidden.status).toBe(403);
      expect((await state()).requests).toHaveLength(0);
      await fixture(envelope('openai', 'Done.'));
      const model = ai('openai', {
        LITELLM_BASE_URL: `${baseURL}/v1`,
        LITELLM_API_KEY: key,
      }).getChatModel('STANDARD');
      await expect(model.invoke('Hello')).resolves.toMatchObject({
        content: expect.anything(),
      });
      const gateway = log.mock.calls
        .map(([line]) => JSON.parse(line))
        .find((event) => event.event === 'llm_gateway_request');
      expect(gateway.costUsd).toBeCloseTo(0.02);
      let spend = 0;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const info = await (
          await fetch(`${baseURL}/key/info?key=${encodeURIComponent(key)}`, {
            headers,
          })
        ).json();
        spend = info.info?.spend ?? 0;
        if (spend >= 0.02) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(spend).toBeCloseTo(0.02);
      await expect(model.invoke('Hello again')).rejects.toMatchObject({
        status: 429,
        message: expect.stringMatching(/budget/i),
      });
      expect((await state()).requests).toHaveLength(1);
    },
    30000,
  );
});
