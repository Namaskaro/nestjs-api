import { randomUUID } from 'node:crypto';
import {
  BaseChatModel,
  type BaseChatModelParams,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  type AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  RunnableBinding,
  RunnableLambda,
  type Runnable,
} from '@langchain/core/runnables';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import type { ChatResult } from '@langchain/core/outputs';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { toJsonSchema, Validator } from '@langchain/core/utils/json_schema';

interface GigaOptions extends BaseChatModelCallOptions {
  functions?: Record<string, unknown>[];
  function_call?: unknown;
  response_format?: unknown;
}
export interface GigaChatDeployment {
  model: string;
  credentials?: string;
  accessToken?: string;
  scope?: string;
  baseURL?: string;
  authURL?: string;
  timeoutMs: number;
}

/** Native v1 text adapter. The official JS adapter cannot yet satisfy Zod 4/history/abort contracts. */
export class DirectGigaChat extends BaseChatModel<GigaOptions> {
  private token?: { access_token: string; expires_at: number };
  private refresh?: Promise<string>;
  constructor(
    private readonly deployment: GigaChatDeployment,
    fields: BaseChatModelParams = {},
  ) {
    super({ ...fields, disableStreaming: true, maxRetries: 0 });
    if (!deployment.credentials && !deployment.accessToken)
      throw new Error('GigaChat credentials or access token required');
    if (deployment.accessToken)
      this.token = {
        access_token: deployment.accessToken,
        expires_at: Infinity,
      };
    if (
      !['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'].includes(
        deployment.scope ?? 'GIGACHAT_API_PERS',
      )
    )
      throw new Error('Invalid GigaChat OAuth scope');
    for (const value of [this.baseURL, this.authURL]) {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(
          'GigaChat endpoints must use HTTPS without credentials/query/fragment',
        );
    }
  }
  private get baseURL() {
    return this.deployment.baseURL ?? 'https://api.giga.chat/v1';
  }
  private get authURL() {
    return (
      this.deployment.authURL ??
      'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
    );
  }
  _llmType() {
    return 'gigachat-native';
  }

  private async json(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<any> {
    signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    signal.throwIfAborted();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      /* HTTP failures may have a plain body. */
    }
    if (!response.ok) {
      const error = new Error(`GigaChat HTTP ${response.status}`) as Error & {
        status: number;
        code?: string;
        requestId?: string;
      };
      error.status = response.status;
      error.code = String(data?.error?.code ?? data?.code ?? '');
      error.requestId = response.headers.get('x-request-id') ?? undefined;
      throw error;
    }
    if (!data || typeof data !== 'object')
      throw Object.assign(new Error('Malformed GigaChat response'), {
        name: 'ChatTransportError',
      });
    return data;
  }

  private accessToken(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (this.token && this.token.expires_at > Date.now() + 30_000)
      return Promise.resolve(this.token.access_token);
    if (!this.deployment.credentials)
      throw new Error(
        'GigaChat access token expired/rejected; configure OAuth credentials',
      );
    // Shared credential refresh has its own bounded lifetime; one cancelled chat cannot cancel other chats' refresh.
    this.refresh ??= this.json(
      this.authURL,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.deployment.credentials}`,
          RqUID: randomUUID(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          scope: this.deployment.scope ?? 'GIGACHAT_API_PERS',
        }).toString(),
      },
      AbortSignal.timeout(this.deployment.timeoutMs),
    )
      .then((data) => {
        if (
          typeof data.access_token !== 'string' ||
          !data.access_token ||
          !Number.isFinite(data.expires_at) ||
          data.expires_at <= Date.now()
        )
          throw new Error('Invalid GigaChat OAuth response');
        this.token = data;
        return data.access_token as string;
      })
      .finally(() => {
        this.refresh = undefined;
      });
    return new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      this.refresh
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', aborted));
    });
  }

  private messages(messages: BaseMessage[]): Record<string, unknown>[] {
    const tools = new Map<string, string>();
    return messages.map((message) => {
      let content = message.content;
      if (typeof content !== 'string') {
        if (
          !Array.isArray(content) ||
          !Array.from(content).every(
            (block) =>
              block !== null &&
              typeof block === 'object' &&
              !Array.isArray(block) &&
              block.type === 'text' &&
              typeof block.text === 'string' &&
              Object.keys(block).every((key) => key === 'type' || key === 'text'),
          )
        )
          throw new Error(
            'GigaChat text adapter does not accept multimodal or opaque reasoning blocks',
          );
        content = content.map((block) => block.text).join('');
      }
      const type = message.getType();
      if (type === 'human' || type === 'system')
        return {
          role: type === 'human' ? 'user' : 'system',
          content,
        };
      if (type === 'tool') {
        const id = (message as any).tool_call_id;
        const name = tools.get(id);
        if (!name)
          throw new Error(
            'GigaChat tool result has no preceding matching call',
          );
        return { role: 'function', name, content };
      }
      if (type !== 'ai') throw new Error('Unsupported GigaChat message type');
      const calls = (message as AIMessage).tool_calls ?? [];
      if (calls.length > 1)
        throw new Error('GigaChat v1 supports one function per model turn');
      const call = calls[0];
      if (call) tools.set(call.id, call.name);
      return {
        role: 'assistant',
        content,
        ...(call
          ? { function_call: { name: call.name, arguments: call.args } }
          : {}),
        ...(message.additional_kwargs.functions_state_id
          ? { functions_state_id: message.additional_kwargs.functions_state_id }
          : {}),
      };
    });
  }

  async _generate(
    messages: BaseMessage[],
    options: GigaOptions,
  ): Promise<ChatResult> {
    options.signal?.throwIfAborted();
    const wireMessages = this.messages(messages);
    const timeout = AbortSignal.timeout(this.deployment.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    try {
      const token = await this.accessToken(signal);
      signal.throwIfAborted();
      const body = await this.json(
        this.baseURL.replace(/\/$/, '') + '/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.deployment.model,
            messages: wireMessages,
            stream: false,
            temperature: 0,
            ...(options.functions
              ? {
                  functions: options.functions,
                  function_call: options.function_call ?? 'auto',
                }
              : {}),
            ...(options.response_format
              ? { response_format: options.response_format }
              : {}),
            ...(options.stop ? { stop: options.stop } : {}),
          }),
        },
        signal,
      );
      const choice = body.choices?.[0];
      const message = choice?.message;
      if (
        body.choices?.length !== 1 ||
        !['stop', 'function_call'].includes(choice?.finish_reason) ||
        message?.role !== 'assistant' ||
        typeof message.content !== 'string'
      )
        throw Object.assign(
          new Error(
            'GigaChat response is not a completed text/function response',
          ),
          { name: 'ChatTransportError' },
        );
      const call = message.function_call;
      if (
        (choice.finish_reason === 'function_call') !== Boolean(call) ||
        (call &&
          (typeof call.name !== 'string' ||
            !call.arguments ||
            typeof call.arguments !== 'object' ||
            Array.isArray(call.arguments)))
      )
        throw Object.assign(new Error('Invalid GigaChat function response'), {
          name: 'ChatTransportError',
        });
      const result = new AIMessage({
        content: message.content,
        id: randomUUID(),
        tool_calls: call
          ? [
              {
                id: randomUUID(),
                name: call.name,
                args: call.arguments,
                type: 'tool_call',
              },
            ]
          : [],
        additional_kwargs: message.functions_state_id
          ? { functions_state_id: message.functions_state_id }
          : {},
        response_metadata: {
          provider: 'gigachat',
          model: body.model,
          finish_reason: choice.finish_reason,
        },
        ...(body.usage
          ? {
              usage_metadata: {
                input_tokens: body.usage.prompt_tokens,
                output_tokens: body.usage.completion_tokens,
                total_tokens: body.usage.total_tokens,
              },
            }
          : {}),
      });
      signal.throwIfAborted();
      return { generations: [{ text: result.text, message: result }] };
    } catch (error) {
      options.signal?.throwIfAborted();
      if ((error as any).status === 401) this.token = undefined; // No automatic model replay on authorization failure.
      if (timeout.aborted)
        throw Object.assign(new Error('GigaChat request timed out'), {
          name: 'APIConnectionTimeoutError',
        });
      if (
        (error as any).name === 'TypeError' &&
        (error as Error).message === 'fetch failed'
      )
        throw Object.assign(new Error('GigaChat connection failed'), {
          name: 'APIConnectionError',
          cause: (error as any).cause,
        });
      throw error;
    }
  }

  bindTools(
    tools: BindToolsInput[],
    options?: Record<string, any>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, GigaOptions> {
    if (options?.parallel_tool_calls === true)
      throw new Error('GigaChat v1 does not support parallel function calls');
    const functions = tools.map((tool) => {
      const f =
        typeof (tool as any).name === 'string' && (tool as any).parameters
          ? (tool as any)
          : convertToOpenAITool(tool).function;
      return {
        name: f.name,
        description: f.description ?? f.name,
        parameters: f.parameters,
      };
    });
    const choice = options?.tool_choice;
    const function_call =
      choice === undefined || choice === 'auto' || choice === 'none'
        ? choice
        : typeof choice === 'string'
        ? { name: choice }
        : { name: choice.function?.name };
    return new RunnableBinding({
      bound: this,
      config: {},
      kwargs: { functions, function_call },
    });
  }

  withStructuredOutput: BaseChatModel['withStructuredOutput'] = ((
    schema: any,
    config?: any,
  ): Runnable<any, any> => {
    const jsonSchema = toJsonSchema(schema);
    const method = config?.method ?? 'functionCalling';
    const name = config?.name ?? 'structured_response';
    if (!['jsonMode', 'jsonSchema', 'functionCalling'].includes(method))
      throw new Error('Unsupported GigaChat structured output method');
    if (config?.strict !== undefined && typeof config.strict !== 'boolean')
      throw new Error('GigaChat strict must be a boolean');
    // Native functions have no strict option; do not promise server enforcement.
    if (method === 'functionCalling' && config?.strict === true)
      throw new Error(
        'GigaChat functionCalling does not support strict:true; use jsonSchema for native strict output',
      );
    const model =
      method === 'functionCalling'
        ? this.bindTools(
            [
              {
                type: 'function',
                function: { name, description: name, parameters: jsonSchema },
              },
            ],
            { tool_choice: name },
          )
        : new RunnableBinding({
            bound: this,
            config: {},
            kwargs: {
              response_format: {
                type: 'json_schema',
                schema: jsonSchema,
                strict: config?.strict ?? true,
              },
            },
          });
    return RunnableLambda.from(
      async (input: BaseLanguageModelInput, options) => {
        const raw = await model.invoke(input, options);
        try {
          const value =
            method === 'functionCalling'
              ? raw.tool_calls?.find((call) => call.name === name)?.args
              : JSON.parse(raw.text);
          const parsed =
            typeof schema.parseAsync === 'function'
              ? await schema.parseAsync(value)
              : value;
          if (
            typeof schema.parseAsync !== 'function' &&
            !new Validator(
              jsonSchema as ConstructorParameters<typeof Validator>[0],
            ).validate(value).valid
          )
            throw new Error('Invalid GigaChat structured output');
          return config?.includeRaw ? { raw, parsed } : parsed;
        } catch (error) {
          if (config?.includeRaw) return { raw, parsed: null };
          throw error;
        }
      },
    );
  }) as BaseChatModel['withStructuredOutput'];
}
