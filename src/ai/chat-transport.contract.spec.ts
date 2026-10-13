import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';

import { AiService, type AiProvider, type ChatModelRole } from './ai.service';
import { createConsultationAgent } from '../product-consultation/application/consultation-agent/consultation.agent';
import { ProductRecommendationSynthesisSchema } from '../product-consultation/application/recommendation/product-recommendation-synthesizer';
import { HandoffContextSchema } from '../support-agent/agents/handoff-agent/schemas/handoff.schema';
import { RequestRouterModelSchema } from '../support-agent/schemas/request-router.schema';
import { ProductSemanticRepresentationSchema } from './schemas/semantic-product-representation.schema';
import { createCustomerHelpAgent } from '../support-agent/agents/customer-help-agent/customer-help.agent';
import type { StoreKnowledgeService } from '../store-knowledge/store-knowledge.service';

// Real ChatOpenAI, OpenAI SDK, Runnable pipelines and Zod parsers. Only HTTP is
// mocked, so tests exercise serialized requests and provider-envelope conversion.
type Deployment = {
  provider: AiProvider;
  role: Exclude<ChatModelRole, 'STRONG'>;
  model: string;
};

const deployments: Deployment[] = [
  {
    provider: 'yandex',
    role: 'FAST',
    model: 'gpt://offline/yandexgpt-lite/latest',
  },
  {
    provider: 'yandex',
    role: 'STANDARD',
    model: 'gpt://offline/yandexgpt/latest',
  },
  { provider: 'openai', role: 'FAST', model: 'gpt-6-luna' },
  { provider: 'openai', role: 'STANDARD', model: 'gpt-6.1-sol' },
];
const schema = z
  .object({ value: z.string().min(1), count: z.number().int() })
  .strict();
const valid = { value: 'offline result', count: 2 };

function service(deployment: Deployment, extra: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    CHAT_PROVIDER: deployment.provider,
    EMBEDDING_PROVIDER: 'yandex',
    ...(deployment.provider === 'yandex'
      ? {
          YANDEX_API_KEY: 'offline-yandex-key',
          YANDEX_API_URL: 'https://yandex.invalid/v1',
          YANDEX_LITE_MODEL: deployment.model,
          YANDEX_MODEL: deployment.model,
        }
      : {
          OPENAI_API_KEY: 'offline-openai-key',
          OPENAI_FAST_MODEL: deployment.model,
          OPENAI_STANDARD_MODEL: deployment.model,
        }),
    ...extra,
  };
  return new AiService({ get: (key: string) => values[key] } as ConfigService);
}

function toolResponse(
  d: Deployment,
  args = JSON.stringify(valid),
  name = 'emit_result',
) {
  return d.provider === 'yandex'
    ? {
        id: 'chatcmpl_offline',
        object: 'chat.completion',
        created: 1,
        model: d.model,
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
                  function: { name, arguments: args },
                },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      }
    : {
        id: 'resp_offline',
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: d.model,
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
            name,
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

function textResponse(d: Deployment, text: string) {
  const response = toolResponse(d);
  if (d.provider === 'yandex') {
    return {
      ...response,
      id: 'chatcmpl_offline_text',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: text },
        },
      ],
    };
  }
  return {
    ...response,
    id: 'resp_offline_text',
    output: [
      {
        type: 'message',
        id: 'msg_offline',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
  };
}

describe('Chat transport HTTP contracts (offline)', () => {
  let requests: Array<{ url: string; body: Record<string, any> }>;
  let replies: unknown[];
  let fetchMock: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    requests = [];
    replies = [];
    jest.replaceProperty(process, 'env', {
      ...process.env,
      LANGSMITH_TRACING: 'false',
      LANGCHAIN_TRACING_V2: 'false',
    });
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, init) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)),
        });
        if (!replies.length)
          throw new Error('Unexpected HTTP request: network is forbidden');
        return new Response(JSON.stringify(replies.shift()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(deployments)(
    '$provider $role sends the correct transport and normalizes function output',
    async (d) => {
      replies.push(toolResponse(d));
      const ai = service(d);
      const model = ai.getChatModel(d.role);
      expect(ai.getChatModel(d.role)).toBe(model);
      expect(fetchMock).not.toHaveBeenCalled();

      const result = await model
        .withStructuredOutput(schema, {
          name: 'emit_result',
          method: 'functionCalling',
          strict: false,
          includeRaw: true,
        })
        .invoke('Return a result.', {
          tags: ['contract-test'],
          metadata: { testContext: true },
        });

      expect(result.parsed).toEqual(valid);
      expect(result.raw.tool_calls).toEqual([
        {
          name: 'emit_result',
          args: valid,
          id: 'call_offline',
          type: 'tool_call',
        },
      ]);
      expect(result.raw.usage_metadata).toMatchObject({
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      });
      expect(requests).toHaveLength(1);
      const { url, body } = requests[0];
      expect(body.model).toBe(d.model);
      expect(body.stream).toBe(false);
      if (d.provider === 'yandex') {
        expect(url).toBe('https://yandex.invalid/v1/chat/completions');
        expect(body.temperature).toBe(0);
        expect(body).not.toHaveProperty('reasoning');
        expect(body).not.toHaveProperty('reasoning_effort');
        expect(body).not.toHaveProperty('input');
        expect(body.tools[0]).toMatchObject({
          type: 'function',
          function: { name: 'emit_result', strict: false },
        });
        expect(body.tool_choice).toEqual({
          type: 'function',
          function: { name: 'emit_result' },
        });
      } else {
        expect(url).toBe('https://api.openai.com/v1/responses');
        expect(body.reasoning).toEqual({
          effort: d.role === 'FAST' ? 'none' : 'medium',
        });
        expect(body.store).toBe(false);
        expect(body.include).toContain('reasoning.encrypted_content');
        expect(body).not.toHaveProperty('messages');
        expect(body).not.toHaveProperty('reasoning_effort');
        expect(body.tools[0]).toMatchObject({
          type: 'function',
          name: 'emit_result',
          strict: false,
        });
        expect(body.tool_choice).toEqual({
          type: 'function',
          name: 'emit_result',
        });
        if (d.role === 'STANDARD')
          expect(body).not.toHaveProperty('temperature');
        else expect(body.temperature).toBe(0);
        for (const key of ['top_p', 'top_logprobs', 'logprobs'])
          expect(body).not.toHaveProperty(key);
      }

      const usage = log.mock.calls
        .map(([message]) => JSON.parse(message))
        .find((event) => event.event === 'llm_call');
      expect(usage).toMatchObject({
        status: 'success',
        model: d.model,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 3,
        metadata: {
          role: d.role,
          provider: d.provider,
          model: d.model,
          testContext: true,
        },
        tags: expect.arrayContaining([
          `role:${d.role}`,
          `provider:${d.provider}`,
          `model:${d.model}`,
          'contract-test',
        ]),
        runId: expect.any(String),
        // A model-level callback has no inherited parent in this SDK pipeline.
        parentRunId: null,
      });
    },
  );

  it.each(deployments)(
    '$provider $role preserves JSON mode and Zod validation',
    async (d) => {
      replies.push(
        textResponse(
          d,
          JSON.stringify({
            message: 'Подходит для прогулки.',
            recommendedPosition: 2,
          }),
        ),
        textResponse(
          d,
          JSON.stringify({
            message: 'Invalid position',
            recommendedPosition: 0,
          }),
        ),
      );
      const model = service(d)
        .getChatModel(d.role)
        .withStructuredOutput(ProductRecommendationSynthesisSchema, {
          name: 'product_recommendation_response',
          method: 'jsonMode',
        });
      await expect(model.invoke('Return JSON.')).resolves.toEqual({
        message: 'Подходит для прогулки.',
        recommendedPosition: 2,
      });
      await expect(model.invoke('Return JSON.')).rejects.toThrow();
      if (d.provider === 'openai')
        expect(requests[0].body.text.format).toEqual({ type: 'json_object' });
      else
        expect(requests[0].body.response_format).toEqual({
          type: 'json_object',
        });
    },
  );

  it.each(deployments)(
    '$provider $role preserves the default structured-output method',
    async (d) => {
      replies.push(textResponse(d, JSON.stringify(valid)));
      const result = await service(d)
        .getChatModel(d.role)
        .withStructuredOutput(schema, {
          name: 'emit_result',
          includeRaw: true,
        })
        .invoke('Return JSON.');
      expect(result.parsed).toEqual(valid);
      const format =
        d.provider === 'openai'
          ? requests[0].body.text.format
          : requests[0].body.response_format;
      expect(format.type).toBe('json_schema');
    },
  );

  it.each(deployments)(
    '$provider $role round-trips bound tool calls and tool results',
    async (d) => {
      replies.push(toolResponse(d), textResponse(d, 'Done.'));
      const model = service(d)
        .getChatModel(d.role)
        .bindTools([{ name: 'emit_result', description: 'Test tool', schema }]);
      const user = new HumanMessage('Use the tool.');
      const first = await model.invoke([user]);
      expect(first.tool_calls?.[0].args).toEqual(valid);
      const second = await model.invoke([
        user,
        first,
        new ToolMessage({
          tool_call_id: 'call_offline',
          content: 'Tool succeeded.',
        }),
      ]);
      expect(second.text).toBe('Done.');
      const body = requests[1].body;
      if (d.provider === 'openai') {
        expect(body.input).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'reasoning',
              encrypted_content: 'offline-encrypted',
            }),
            expect.objectContaining({
              type: 'function_call',
              call_id: 'call_offline',
              arguments: JSON.stringify(valid),
            }),
            expect.objectContaining({
              type: 'function_call_output',
              call_id: 'call_offline',
              output: 'Tool succeeded.',
            }),
          ]),
        );
        expect(body.store).toBe(false);
      } else
        expect(body.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'assistant',
              tool_calls: expect.any(Array),
            }),
            {
              role: 'tool',
              tool_call_id: 'call_offline',
              content: 'Tool succeeded.',
            },
          ]),
        );
    },
  );

  it.each(deployments)(
    '$provider $role keeps malformed tool arguments out of parsed output',
    async (d) => {
      replies.push(toolResponse(d, '{broken JSON'));
      const result = await service(d)
        .getChatModel(d.role)
        .withStructuredOutput(schema, {
          method: 'functionCalling',
          name: 'emit_result',
          includeRaw: true,
        })
        .invoke('Return a result.');
      expect(result.parsed == null).toBe(true);
      expect(result.raw.invalid_tool_calls?.[0].args).toBe('{broken JSON');
      expect(result.raw.tool_calls).toHaveLength(0);
    },
  );

  it.each(deployments)(
    '$provider $role handles refusal without a structured success',
    async (d) => {
      const response =
        d.provider === 'openai'
          ? {
              ...textResponse(d, ''),
              output: [
                {
                  type: 'message',
                  id: 'msg_refusal',
                  role: 'assistant',
                  status: 'completed',
                  content: [{ type: 'refusal', refusal: 'Offline refusal' }],
                },
              ],
            }
          : {
              ...textResponse(d, ''),
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
            };
      replies.push(response);
      const result = await service(d)
        .getChatModel(d.role)
        .withStructuredOutput(schema, {
          method: 'functionCalling',
          name: 'emit_result',
          includeRaw: true,
        })
        .invoke('Return a result.');
      expect(result.parsed == null).toBe(true);
      if (d.provider === 'openai') {
        expect(result.raw.additional_kwargs.refusal).toBe('Offline refusal');
      } else {
        // Existing 1.5.6 Chat Completions conversion drops the refusal field.
        // Preserve its empty-result behavior; do not synthesize a success.
        expect(result.raw.content).toBe('');
        expect(result.raw.tool_calls).toHaveLength(0);
      }
    },
  );

  it.each(deployments)(
    '$provider $role rejects truncation before structured parsing',
    async (d) => {
      const response =
        d.provider === 'openai'
          ? {
              ...textResponse(d, '{"value":'),
              status: 'incomplete',
              incomplete_details: { reason: 'max_output_tokens' },
            }
          : {
              ...textResponse(d, ''),
              choices: [
                {
                  index: 0,
                  finish_reason: 'length',
                  message: { role: 'assistant', content: '{"value":' },
                },
              ],
            };
      replies.push(response);
      const result = service(d)
        .getChatModel(d.role)
        .withStructuredOutput(schema, {
          method: 'jsonMode',
          name: 'emit_result',
          includeRaw: true,
        })
        .invoke('Return JSON.');
      await expect(result).rejects.toMatchObject({
        cause: expect.objectContaining({ name: 'ChatTransportError' }),
      });
    },
  );

  it('passes Responses raw tool args through the unchanged workspace normalization and repair', async () => {
    const d = deployments[3];
    const rawPlan = {
      operations: [
        {
          target: { kind: 'current', view: 'results' },
          decision: { action: 'SHOW_RESULTS', selection: { kind: 'active' } },
          view: 'results',
        },
      ],
    };
    replies.push(
      toolResponse(d, '{broken JSON', 'product_workspace_decision'),
      toolResponse(d, JSON.stringify(rawPlan), 'product_workspace_decision'),
    );
    const result = await createConsultationAgent(service(d)).decideWorkspace({
      currentMessage: 'Покажи найденное',
    });
    expect(result.operations[0]).toMatchObject({
      kind: 'consult',
      query: 'Покажи найденное',
      actions: [
        { decision: { proposal: { action: 'SHOW_RESULTS' } }, view: 'results' },
      ],
    });
    expect(requests).toHaveLength(2);
    expect(requests[1].body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('Предыдущий structured output'),
        }),
      ]),
    );
  });

  it('sends explicit reasoning for a configured deployment alias, without model-name guessing', async () => {
    const d: Deployment = {
      provider: 'openai',
      role: 'STANDARD',
      model: 'commerce-standard-v1',
    };
    replies.push(toolResponse(d));
    const model = service(d, {
      OPENAI_STANDARD_TRANSPORT_PROFILE: 'gpt-6.1-sol',
    }).getChatModel(d.role);
    await model
      .withStructuredOutput(schema, {
        method: 'functionCalling',
        name: 'emit_result',
      })
      .invoke('Return a result.');
    expect(requests[0].body).toMatchObject({
      model: d.model,
      reasoning: { effort: 'medium' },
    });
    expect(requests[0].body).not.toHaveProperty('temperature');
  });

  it.each([
    {
      name: 'router',
      schema: RequestRouterModelSchema,
      role: 'FAST' as const,
      output: {
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
      },
    },
    {
      name: 'handoff',
      schema: HandoffContextSchema,
      role: 'STANDARD' as const,
      output: {
        issue: 'Нужен оператор',
        userGoal: 'Получить помощь',
        verifiedFacts: [],
        actionsTaken: [],
        unresolvedQuestions: [],
        relatedEntities: { orderIds: [], productIds: [] },
      },
    },
    {
      name: 'enrichment',
      schema: ProductSemanticRepresentationSchema,
      role: 'STANDARD' as const,
      output: {
        summary: 'Удобная обувь',
        targetAudience: [],
        styleAssociations: [],
        useCases: [],
        pricePositioning: 'не удалось определить по имеющимся данным',
        searchTags: [],
      },
    },
  ])(
    'serializes the unchanged $name schema and validates the Responses result',
    async (testCase) => {
      const d = deployments.find(
        (d) => d.provider === 'openai' && d.role === testCase.role,
      )!;
      replies.push(textResponse(d, JSON.stringify(testCase.output)));
      const result = await service(d)
        .getChatModel(d.role)
        .withStructuredOutput(testCase.schema, {
          name: testCase.name,
          includeRaw: true,
        })
        .invoke('Return JSON.');
      expect(result.parsed).toEqual(testCase.output);
      const format = requests[0].body.text.format;
      expect(format.type).toBe('json_schema');
      expect(format.strict).toBe(true);
      // Check documented strict-schema object requirements on the actual wire
      // schema, including defaults/nested objects. This is not a full API validator.
      function checkObjects(value: unknown) {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) return value.forEach(checkObjects);
        const record = value as Record<string, any>;
        if (record.type === 'object') {
          expect(record.additionalProperties).toBe(false);
          expect([...(record.required ?? [])].sort()).toEqual(
            Object.keys(record.properties ?? {}).sort(),
          );
        }
        Object.values(record).forEach(checkObjects);
      }
      checkObjects(format.schema);
    },
  );

  it.each([deployments[1], deployments[3]])(
    '$provider preserves the Customer Help tool loop',
    async (d) => {
      replies.push(
        toolResponse(
          d,
          JSON.stringify({ query: 'Доставка' }),
          'search_knowledge',
        ),
        textResponse(d, 'Доставка курьером.'),
      );
      const search = jest.fn(async () => 'Доставка курьером.');
      const help = createCustomerHelpAgent(service(d), {
        search,
      } as unknown as StoreKnowledgeService);
      const result = await help.invoke({
        messages: [new HumanMessage('Расскажи о доставке')],
      });
      expect(search).toHaveBeenCalledWith('Доставка');
      expect(result.messages[result.messages.length - 1]?.text).toBe(
        'Доставка курьером.',
      );
      expect(requests).toHaveLength(2);
      const toolNames = requests[0].body.tools.map(
        (tool: any) => tool.name ?? tool.function.name,
      );
      expect(toolNames).toEqual(
        expect.arrayContaining([
          'search_knowledge',
          'transfer_to_agent',
          'request_operator_handoff',
        ]),
      );
    },
  );

  it.each([deployments[1], deployments[3]])(
    '$provider supports graph v3 events without implicitly streaming incomplete provider output',
    async (d) => {
      replies.push(
        toolResponse(
          d,
          JSON.stringify({ query: 'Доставка' }),
          'search_knowledge',
        ),
        textResponse(d, 'Доставка курьером.'),
      );
      const search = jest.fn(async () => 'Доставка курьером.');
      const graph = createCustomerHelpAgent(service(d), {
        search,
      } as unknown as StoreKnowledgeService);
      const events = [];
      for await (const event of await graph.streamEvents(
        { messages: [new HumanMessage('Доставка')] },
        { version: 'v3' },
      ))
        events.push(event);
      expect(events.length).toBeGreaterThan(0);
      expect(JSON.stringify(events)).toContain('Доставка курьером.');
      expect(search).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(2);
      for (const request of requests)
        expect(request.body.stream).not.toBe(true);
    },
  );

  it('rejects a malformed Responses envelope without inventing parsed data', async () => {
    const d = deployments[3];
    replies.push({
      ...textResponse(d, '{}'),
      output: { invalid: 'not an array' },
    });
    await expect(
      service(d)
        .getChatModel(d.role)
        .withStructuredOutput(schema, {
          method: 'jsonMode',
          includeRaw: true,
        })
        .invoke('Return JSON.'),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a provider HTTP error with the existing usage callback and no retry/fallback', async () => {
    const d = deployments[3];
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: 'Offline unsupported parameter',
            type: 'invalid_request_error',
            code: 'unsupported_parameter',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      service(d).getChatModel(d.role).invoke('Hello'),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const warnings = jest
      .mocked(Logger.prototype.warn)
      .mock.calls.map(([message]) => JSON.parse(String(message)));
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'llm_call',
          status: 'error',
          runId: expect.any(String),
          tags: expect.arrayContaining([
            'provider:openai',
            'role:STANDARD',
            `model:${d.model}`,
          ]),
          metadata: expect.objectContaining({
            role: 'STANDARD',
            provider: 'openai',
            model: d.model,
          }),
        }),
      ]),
    );
  });
});
