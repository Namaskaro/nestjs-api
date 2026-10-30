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

/**
 * Converts nullable JSON Schema types into the representation
 * accepted by GigaChat function parameters.
 *
 * This transformation is used only for function calling.
 * The original schema is preserved for native structured output.
 */
function toGigaChatSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toGigaChatSchema);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(source)) {
    result[key] = toGigaChatSchema(nested);
  }

  if (Array.isArray(result.type)) {
    const nonNullTypes = result.type.filter((entry) => entry !== 'null');

    if (
      result.type.length === 2 &&
      result.type.includes('null') &&
      nonNullTypes.length === 1 &&
      typeof nonNullTypes[0] === 'string'
    ) {
      result.type = nonNullTypes[0];
      result.nullable = true;
    } else {
      throw new Error('GigaChat schema contains an unsupported type union');
    }
  }

  // GigaChat requires a description on every function parameter.
  if (result.properties && typeof result.properties === 'object') {
    for (const [name, property] of Object.entries(result.properties)) {
      if (property && typeof property === 'object' && !Array.isArray(property)) {
        const parameter = property as Record<string, unknown>;
        parameter.description ??= name;
      }
    }
  }

  const anyOf = result.anyOf;

  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const nullIndex = anyOf.findIndex((branch) => {
      if (!branch || typeof branch !== 'object' || Array.isArray(branch)) {
        return false;
      }

      const node = branch as Record<string, unknown>;

      return Object.keys(node).length === 1 && node.type === 'null';
    });

    if (nullIndex !== -1) {
      const other = anyOf[1 - nullIndex];

      if (other && typeof other === 'object' && !Array.isArray(other)) {
        const actual = other as Record<string, unknown>;

        if (typeof actual.type === 'string' && actual.type !== 'null') {
          const { anyOf: _discard, ...annotations } = result;

          return {
            ...actual,
            ...annotations,
            nullable: true,
          };
        }
      }
    }
  }

  return result;
}

/**
 * Detects schema compositions that cannot be represented
 * as a single concrete type in GigaChat function parameters.
 *
 * Examples:
 * - discriminated unions
 * - anyOf / oneOf
 * - allOf
 * - references
 *
 * Such schemas should be sent through native JSON Schema
 * structured output instead of function calling.
 */
function hasUntypedSchemaComposition(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasUntypedSchemaComposition);
  }

  if (value === null || typeof value !== 'object') {
    return false;
  }

  const node = value as Record<string, unknown>;

  if (
    typeof node.type !== 'string' &&
    (Array.isArray(node.anyOf) ||
      Array.isArray(node.oneOf) ||
      Array.isArray(node.allOf) ||
      typeof node.$ref === 'string')
  ) {
    return true;
  }

  return Object.values(node).some(hasUntypedSchemaComposition);
}

/**
 * Native GigaChat v1 text adapter.
 *
 * Handles OAuth, native functions, structured output,
 * cancellation and response validation.
 */
export class DirectGigaChat extends BaseChatModel<GigaOptions> {
  private token?: {
    access_token: string;
    expires_at: number;
  };

  private refresh?: Promise<string>;

  constructor(
    private readonly deployment: GigaChatDeployment,
    fields: BaseChatModelParams = {},
  ) {
    super({
      ...fields,
      disableStreaming: true,
      maxRetries: 0,
    });

    if (!deployment.credentials && !deployment.accessToken) {
      throw new Error('GigaChat credentials or access token required');
    }

    if (deployment.accessToken) {
      this.token = { access_token: deployment.accessToken, expires_at: Infinity };
    }

    if (
      !['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'].includes(
        deployment.scope ?? 'GIGACHAT_API_PERS',
      )
    ) {
      throw new Error('Invalid GigaChat OAuth scope');
    }

    for (const value of [this.baseURL, this.authURL]) {
      const url = new URL(value);

      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          'GigaChat endpoints must use HTTPS without credentials/query/fragment',
        );
      }
    }
  }

  private get baseURL(): string {
    return this.deployment.baseURL ?? 'https://api.giga.chat/v1';
  }

  private get authURL(): string {
    return (
      this.deployment.authURL ??
      'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
    );
  }

  _llmType(): string {
    return 'gigachat-native';
  }

  private async json(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<any> {
    signal.throwIfAborted();

    const response = await fetch(url, {
      ...init,
      signal,
    });

    const text = await response.text();

    signal.throwIfAborted();

    let data: any;

    try {
      data = JSON.parse(text);
    } catch {
      // HTTP errors may have plain-text bodies.
    }

    if (!response.ok) {
      const detail = data?.detail;

      let providerMessage: string | undefined;

      if (typeof data?.message === 'string') {
        providerMessage = data.message;
      } else if (typeof data?.error?.message === 'string') {
        providerMessage = data.error.message;
      } else if (typeof data?.error_description === 'string') {
        providerMessage = data.error_description;
      } else if (typeof detail === 'string') {
        providerMessage = detail;
      } else if (Array.isArray(detail)) {
        const messages = detail
          .map((item: unknown): string | null => {
            if (
              item === null ||
              typeof item !== 'object' ||
              Array.isArray(item)
            ) {
              return null;
            }

            const entry = item as {
              loc?: unknown;
              msg?: unknown;
            };

            if (typeof entry.msg !== 'string') {
              return null;
            }

            const location = Array.isArray(entry.loc)
              ? entry.loc
                  .filter(
                    (part): part is string | number =>
                      typeof part === 'string' || typeof part === 'number',
                  )
                  .join('.')
              : '';

            return location ? `${location}: ${entry.msg}` : entry.msg;
          })
          .filter((message): message is string => message !== null);

        providerMessage = messages.join('; ');
      } else if (typeof data?.error === 'string') {
        providerMessage = data.error;
      }

      // API diagnostics may echo submitted values; never expose credentials or messages.
      const privateValues = [
        this.deployment.credentials,
        this.deployment.accessToken,
        this.token?.access_token,
        new Headers(init.headers).get('Authorization'),
      ];
      try {
        const request = JSON.parse(typeof init.body === 'string' ? init.body : '{}');
        for (const message of request.messages ?? []) {
          if (typeof message.content === 'string') privateValues.push(message.content);
        }
      } catch { /* OAuth uses a form body. */ }
      const safeDetail = (value: string) => {
        for (const secret of privateValues) {
          if (!secret) continue;
          value = value.split(secret).join('[REDACTED]');
          value = value.split(JSON.stringify(secret).slice(1, -1)).join('[REDACTED]');
        }
        return value.replace(/(?:Bearer|Basic)\s+[^\s,;]+/gi, '[REDACTED]')
          .replace(/[\r\n\t]+/g, ' ').slice(0, 1200);
      };
      const requestId = response.headers.get('x-request-id') ?? undefined;
      const param = data?.error?.param ?? data?.param;
      const diagnostic = safeDetail([
        typeof param === 'string' ? param : undefined,
        providerMessage,
      ].filter(Boolean).join(': '));
      const error = new Error(
        `GigaChat HTTP ${response.status}` +
          (diagnostic ? `: ${diagnostic}` : '') +
          (requestId ? ` (requestId: ${safeDetail(requestId)})` : ''),
      ) as Error & {
        status: number;
        code?: string;
        requestId?: string;
      };

      error.status = response.status;

      error.code = String(data?.error?.code ?? data?.code ?? '');

      error.requestId = requestId;

      throw error;
    }

    if (!data || typeof data !== 'object') {
      throw Object.assign(new Error('Malformed GigaChat response'), {
        name: 'ChatTransportError',
      });
    }

    return data;
  }

  private accessToken(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();

    if (this.token && this.token.expires_at > Date.now() + 30_000) {
      return Promise.resolve(this.token.access_token);
    }

    if (!this.deployment.credentials) {
      throw new Error(
        'GigaChat access token expired/rejected; configure OAuth credentials',
      );
    }

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
        ) {
          throw new Error('Invalid GigaChat OAuth response');
        }

        this.token = data;

        return data.access_token as string;
      })
      .finally(() => {
        this.refresh = undefined;
      });

    return new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason);

      signal.addEventListener('abort', aborted, {
        once: true,
      });

      this.refresh!.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', aborted);
      });
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
              Object.keys(block).every(
                (key) => key === 'type' || key === 'text',
              ),
          )
        ) {
          throw new Error(
            'GigaChat text adapter does not accept multimodal or opaque reasoning blocks',
          );
        }

        content = content.map((block) => block.text).join('');
      }

      const type = message.getType();

      if (type === 'human' || type === 'system') {
        return {
          role: type === 'human' ? 'user' : 'system',
          content,
        };
      }

      if (type === 'tool') {
        const id = (message as any).tool_call_id;

        const name = tools.get(id);

        if (!name) {
          throw new Error(
            'GigaChat tool result has no preceding matching call',
          );
        }

        return {
          role: 'function',
          name,
          content,
        };
      }

      if (type !== 'ai') {
        throw new Error('Unsupported GigaChat message type');
      }

      const calls = (message as AIMessage).tool_calls ?? [];

      if (calls.length > 1) {
        throw new Error('GigaChat v1 supports one function per model turn');
      }

      const call = calls[0];

      if (call) {
        tools.set(call.id, call.name);
      }

      return {
        role: 'assistant',
        content,
        ...(call
          ? {
              function_call: {
                name: call.name,
                arguments: call.args,
              },
            }
          : {}),
        ...(message.additional_kwargs.functions_state_id
          ? {
              functions_state_id: message.additional_kwargs.functions_state_id,
            }
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
              ? {
                  response_format: options.response_format,
                }
              : {}),
            ...(options.stop
              ? {
                  stop: options.stop,
                }
              : {}),
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
      ) {
        throw Object.assign(
          new Error(
            'GigaChat response is not a completed text/function response',
          ),
          {
            name: 'ChatTransportError',
          },
        );
      }

      const call = message.function_call;

      if (
        (choice.finish_reason === 'function_call') !== Boolean(call) ||
        (call &&
          (typeof call.name !== 'string' ||
            !call.arguments ||
            typeof call.arguments !== 'object' ||
            Array.isArray(call.arguments)))
      ) {
        throw Object.assign(new Error('Invalid GigaChat function response'), {
          name: 'ChatTransportError',
        });
      }

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
          ? {
              functions_state_id: message.functions_state_id,
            }
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

      return {
        generations: [
          {
            text: result.text,
            message: result,
          },
        ],
      };
    } catch (error) {
      options.signal?.throwIfAborted();

      if ((error as any).status === 401) {
        this.token = undefined;
      }

      if (timeout.aborted) {
        throw Object.assign(new Error('GigaChat request timed out'), {
          name: 'APIConnectionTimeoutError',
        });
      }

      if (
        (error as any).name === 'TypeError' &&
        (error as Error).message === 'fetch failed'
      ) {
        throw Object.assign(new Error('GigaChat connection failed'), {
          name: 'APIConnectionError',
          cause: (error as any).cause,
        });
      }

      throw error;
    }
  }

  bindTools(
    tools: BindToolsInput[],
    options?: Record<string, any>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, GigaOptions> {
    if (options?.parallel_tool_calls === true) {
      throw new Error('GigaChat v1 does not support parallel function calls');
    }

    const functions = tools.map((tool) => {
      const f =
        typeof (tool as any).name === 'string' && (tool as any).parameters
          ? (tool as any)
          : convertToOpenAITool(tool).function;

      return {
        name: f.name,
        description: f.description ?? f.name,
        parameters: toGigaChatSchema(f.parameters),
      };
    });

    const choice = options?.tool_choice;

    const function_call =
      choice === undefined || choice === 'auto' || choice === 'none'
        ? choice
        : typeof choice === 'string'
        ? { name: choice }
        : {
            name: choice.function?.name,
          };

    return new RunnableBinding({
      bound: this,
      config: {},
      kwargs: {
        functions,
        function_call,
      },
    });
  }

  withStructuredOutput: BaseChatModel['withStructuredOutput'] = ((
    schema: any,
    config?: any,
  ): Runnable<any, any> => {
    const originalJsonSchema = toJsonSchema(schema);

    // Function calling and native structured output use
    // different validation mechanisms in GigaChat.
    const functionJsonSchema = toGigaChatSchema(originalJsonSchema);

    const requestedMethod = config?.method ?? 'functionCalling';

    // Complex unions cannot be represented faithfully
    // as a single function-parameter type.
    const method =
      requestedMethod === 'functionCalling' &&
      hasUntypedSchemaComposition(functionJsonSchema)
        ? 'jsonSchema'
        : requestedMethod;

    const name = config?.name ?? 'structured_response';

    if (!['jsonMode', 'jsonSchema', 'functionCalling'].includes(method)) {
      throw new Error('Unsupported GigaChat structured output method');
    }

    if (config?.strict !== undefined && typeof config.strict !== 'boolean') {
      throw new Error('GigaChat strict must be a boolean');
    }

    if (method === 'functionCalling' && config?.strict === true) {
      throw new Error(
        'GigaChat functionCalling does not support strict:true; use jsonSchema for native strict output',
      );
    }

    const model =
      method === 'functionCalling'
        ? this.bindTools(
            [
              {
                type: 'function',
                function: {
                  name,
                  description: name,
                  parameters: functionJsonSchema,
                },
              },
            ],
            {
              tool_choice: name,
            },
          )
        : new RunnableBinding({
            bound: this,
            config: {},
            kwargs: {
              response_format: {
                type: 'json_schema',

                // Preserve complete JSON Schema,
                // including composed types.
                schema: originalJsonSchema,

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
              originalJsonSchema as ConstructorParameters<typeof Validator>[0],
            ).validate(value).valid
          ) {
            throw new Error('Invalid GigaChat structured output');
          }

          return config?.includeRaw
            ? {
                raw,
                parsed,
              }
            : parsed;
        } catch (error) {
          if (config?.includeRaw) {
            return {
              raw,
              parsed: null,
            };
          }

          throw error;
        }
      },
    );
  }) as BaseChatModel['withStructuredOutput'];
}
