import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { AiService } from './ai.service';
import { createCustomerHelpAgent } from '../support-agent/agents/customer-help-agent/customer-help.agent';
import type { StoreKnowledgeService } from '../store-knowledge/store-knowledge.service';
import { ProductWorkspaceModelPlanSchema } from '../product-consultation/application/workspace/product-workspace-model-plan';

// Real LangChain/OpenAI SDK, HTTP replaced. No credentials or paid requests.
const schema = z.object({ value: z.string().min(1) }).strict();
const valid = { value: 'offline' };
function completion(
  content: string | null,
  finish = 'stop',
  call?: { name: string; arguments: string },
) {
  return {
    id: 'qwen-offline',
    object: 'chat.completion',
    created: 1,
    model: 'qwen3.7-flash-2026-07-15',
    choices: [
      {
        index: 0,
        finish_reason: finish,
        message: {
          role: 'assistant',
          content,
          ...(call
            ? {
                tool_calls: [
                  { id: 'call_qwen', type: 'function', function: call },
                ],
              }
            : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  };
}
function service(extra: Record<string, unknown> = {}) {
  const values = {
    CHAT_PROVIDER: 'qwen',
    CHAT_FAST_MODEL: 'qwen3.7-flash-2026-07-15',
    CHAT_STANDARD_MODEL: 'qwen3.7-max-2026-06-08',
    QWEN_API_KEY: 'offline-qwen',
    QWEN_API_URL: 'https://qwen.invalid/compatible-mode/v1',
    EMBEDDING_PROVIDER: 'yandex',
    ...extra,
  };
  return new AiService({ get: (key: string) => values[key] } as ConfigService);
}
describe('Qwen direct contracts (offline)', () => {
  let replies: Array<{ body: unknown; status?: number }>;
  let requests: Array<{ url: string; body: any; headers: Headers }>;
  beforeEach(() => {
    replies = [];
    requests = [];
    jest.replaceProperty(process, 'env', {
      ...process.env,
      LANGSMITH_TRACING: 'false',
      LANGCHAIN_TRACING_V2: 'false',
    });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
      });
      const reply = replies.shift();
      if (!reply)
        throw new Error('Unexpected HTTP request; external network forbidden');
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['FAST', 'STANDARD'] as const)(
    '%s invokes Qwen without Yandex/OpenAI credentials or reasoning state',
    async (role) => {
      replies.push({ body: completion('Ответ') });
      const ai = service();
      const model = ai.getChatModel(role);
      expect(ai.getChatModel(role)).toBe(model);
      const result = await model.invoke('Привет');
      expect(result.text).toBe('Ответ');
      expect(result.usage_metadata).toMatchObject({
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(
        'https://qwen.invalid/compatible-mode/v1/chat/completions',
      );
      expect(requests[0].headers.get('authorization')).toBe(
        'Bearer offline-qwen',
      );
      expect(requests[0].body).toMatchObject({
        enable_thinking: false,
        stream: false,
        model:
          role === 'FAST'
            ? 'qwen3.7-flash-2026-07-15'
            : 'qwen3.7-max-2026-06-08',
      });
      expect(requests[0].body).not.toHaveProperty('reasoning');
      expect(requests[0].body).not.toHaveProperty('include');
    },
  );

  it.each([undefined, 'jsonSchema', 'jsonMode', 'functionCalling'] as const)(
    'validates Zod for method %s, including includeRaw',
    async (method) => {
      const body =
        method === 'functionCalling'
          ? completion(null, 'tool_calls', {
              name: 'emit',
              arguments: JSON.stringify(valid),
            })
          : completion(JSON.stringify(valid));
      replies.push({ body });
      const model = service()
        .getChatModel('FAST')
        .withStructuredOutput(schema, {
          method,
          name: 'emit',
          includeRaw: true,
        });
      const result = await model.invoke('Return JSON');
      expect(result.parsed).toEqual(valid);
      expect(result.raw.usage_metadata?.total_tokens).toBe(14);
      const invalid = { value: 42 };
      replies.push({
        body:
          method === 'functionCalling'
            ? completion(null, 'tool_calls', {
                name: 'emit',
                arguments: JSON.stringify(invalid),
              })
            : completion(JSON.stringify(invalid)),
      });
      if (method === undefined || method === 'jsonSchema') {
        await expect(model.invoke('Return JSON')).rejects.toMatchObject({
          issues: expect.arrayContaining([
            expect.objectContaining({ path: ['value'], code: 'invalid_type' }),
          ]),
        });
      } else {
        const rejected = await model.invoke('Return JSON');
        expect(rejected.parsed).toBeNull();
      }
      expect(requests).toHaveLength(2);
      if (method !== 'functionCalling')
        expect(requests[0].body.response_format.type).toBe(
          method === 'jsonMode' ? 'json_object' : 'json_schema',
        );
    },
  );

  it('serializes the real Workspace schema and parses a model plan', async () => {
    const plan = { operations: [], clarification: 'Что подобрать?' };
    replies.push({
      body: completion(null, 'tool_calls', {
        name: 'product_workspace_decision',
        arguments: JSON.stringify(plan),
      }),
    });
    const result = await service()
      .getChatModel('STANDARD')
      .withStructuredOutput(ProductWorkspaceModelPlanSchema, {
        name: 'product_workspace_decision',
        method: 'functionCalling',
        includeRaw: true,
      })
      .invoke('Помогите выбрать');
    expect(result.parsed).toEqual(plan);
    expect(
      requests[0].body.tools[0].function.parameters.properties,
    ).toHaveProperty('operations');
  });

  it('preserves tool call IDs and the complete tool-result history', async () => {
    replies.push(
      {
        body: completion(null, 'tool_calls', {
          name: 'lookup',
          arguments: '{"value":"offline"}',
        }),
      },
      { body: completion('Готово') },
    );
    const model = service().getChatModel('FAST').bindTools!([
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Lookup',
          parameters: z.toJSONSchema(schema),
        },
      },
    ]);
    const human = new HumanMessage('Найди');
    const first = await model.invoke([human]);
    const tool = new ToolMessage({
      content: 'found',
      tool_call_id: first.tool_calls![0].id!,
    });
    const result = await model.invoke([human, first, tool]);
    expect(result.text).toBe('Готово');
    expect(requests[1].body.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'found',
      tool_call_id: 'call_qwen',
    });
    expect(requests[1].body.messages[1].tool_calls[0].id).toBe('call_qwen');
    expect(requests).toHaveLength(2);
  });

  it('runs the real Customer Help graph tool loop and v3 events', async () => {
    replies.push(
      {
        body: completion(null, 'tool_calls', {
          name: 'search_knowledge',
          arguments: '{"query":"Доставка"}',
        }),
      },
      { body: completion('Доставка курьером.') },
    );
    const search = jest.fn(async () => 'Доставка курьером.');
    const graph = createCustomerHelpAgent(service(), {
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
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.body.stream === false)).toBe(
      true,
    );
  });

  it.each(['length', 'content_filter', null, 'unknown'])(
    'rejects incomplete finish %s before returning tool calls',
    async (finish) => {
      const body: any = completion(null, 'tool_calls', {
        name: 'lookup',
        arguments: '{"value":"offline"}',
      });
      body.choices[0].finish_reason = finish;
      replies.push({ body });
      await expect(
        service().getChatModel('FAST').invoke('Найди'),
      ).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );

  it('does not turn refusal into a parsed success', async () => {
    const body: any = completion(null);
    body.choices[0].message.refusal = 'Cannot answer';
    replies.push({ body });
    const result = await service()
      .getChatModel('FAST')
      .withStructuredOutput(schema, { includeRaw: true })
      .invoke('JSON');
    expect(result.parsed).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it.each([401, 429, 500])('does not retry HTTP %s', async (status) => {
    replies.push({
      status,
      body: {
        error: {
          message: 'offline failure',
          type: 'test_error',
          code: 'test_error',
        },
      },
    });
    await expect(
      service().getChatModel('FAST').invoke('test'),
    ).rejects.toMatchObject({ status });
    expect(requests).toHaveLength(1);
  });

  it('aborted invocation makes zero sends', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      service()
        .getChatModel('FAST')
        .invoke('test', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  it('switches either role independently while embeddings stay OpenAI', async () => {
    for (const qwenRole of ['FAST', 'STANDARD']) {
      const ai = service({
        EMBEDDING_PROVIDER: 'openai',
        CHAT_FAST_PROVIDER: qwenRole === 'FAST' ? 'qwen' : 'openai',
        CHAT_STANDARD_PROVIDER: qwenRole === 'STANDARD' ? 'qwen' : 'openai',
        [qwenRole === 'FAST' ? 'CHAT_STANDARD_MODEL' : 'CHAT_FAST_MODEL']:
          'gpt-6-luna',
        OPENAI_API_KEY: 'offline-openai',
      });
      replies.push({ body: completion('ok') });
      await ai.getChatModel(qwenRole as 'FAST' | 'STANDARD').invoke('test');
      expect(
        ai.getChatModel(qwenRole === 'FAST' ? 'STANDARD' : 'FAST'),
      ).toBeDefined();
    }
    expect(requests).toHaveLength(2);
    expect(
      requests.every((request) => request.url.endsWith('/chat/completions')),
    ).toBe(true);
    expect(() => service({ EMBEDDING_PROVIDER: 'qwen' })).toThrow(
      'EMBEDDING_PROVIDER',
    );
  });

  it('does not forward OpenAI encrypted reasoning as Qwen text', async () => {
    const history = new AIMessage({
      content: [
        {
          type: 'reasoning',
          id: 'rs_private',
          summary: [],
          encrypted_content: 'encrypted-openai',
        },
        { type: 'text', text: 'previous answer' },
      ],
    });
    replies.push({ body: completion('ok') });
    await service()
      .getChatModel('FAST')
      .invoke([
        new HumanMessage('previous'),
        history,
        new HumanMessage('next'),
      ]);
    expect(JSON.stringify(requests[0].body)).not.toContain('encrypted-openai');
  });
});
