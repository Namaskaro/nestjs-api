import { Logger } from '@nestjs/common';
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import {
  coerceMessageLikeToMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  CallbackManager,
  type CallbackManagerForLLMRun,
} from '@langchain/core/callbacks/manager';
import { RunnableLambda, type Runnable } from '@langchain/core/runnables';
import type { ChatResult } from '@langchain/core/outputs';

const logger = new Logger('ChatFallback');
// SDK wraps fetch errors, including our completion guard. Inspect the whole cause chain.
export function isChatAvailabilityFailure(error: unknown): boolean {
  // @langchain/openai 1.5.6 drops the SDK timeout cause and exposes this exact error.
  // Caller/node deadlines are checked via the caller signal before classification.
  if ((error as Error)?.name === 'TimeoutError')
    return (error as Error).message === 'Request timed out.';
  let current = error as any;
  let network = false;
  for (let depth = 0; current && depth < 8; depth++, current = current.cause) {
    if (
      ['ChatTransportError', 'AbortError', 'TimeoutError'].includes(
        current.name,
      )
    )
      return false;
    if (
      current.code &&
      /quota|budget|billing|insufficient|payment|balance/i.test(
        String(current.code),
      )
    )
      return false;
    if (
      /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(
        current.code ?? '',
      )
    )
      network = true;
  }
  const failure = error as {
    name?: string;
    status?: number;
    code?: string;
    cause?: { code?: string; name?: string };
  };
  if ([408, 500, 502, 503, 504].includes(failure?.status)) return true;
  if (failure?.status === 429)
    return /^(rate_limit_exceeded|rate_limit_error|RateLimitExceeded|TooManyRequests|Throttling\..+)$/i.test(
      failure.code ?? '',
    );
  if (failure?.name === 'APIConnectionTimeoutError') return true;
  // TLS, malformed URLs and arbitrary fetch/validation errors are not availability.
  return (
    (failure?.name === 'APIConnectionError' ||
      (error as any)?.constructor?.name === 'APIConnectionError') &&
    network
  );
}

function opaqueHistory(
  input: BaseLanguageModelInput,
  destination: string,
): boolean {
  const messages =
    typeof input === 'string'
      ? []
      : Array.isArray(input)
      ? input.map(coerceMessageLikeToMessage)
      : input.toChatMessages();
  return messages.some((message) => {
    const content = Array.isArray(message.content) ? message.content : [];
    if (
      destination !== 'openai' &&
      content.some(
        (block) =>
          ['reasoning', 'reasoning_content'].includes(block.type) ||
          'encrypted_content' in block,
      )
    )
      return true;
    if (
      destination !== 'gigachat' &&
      message.additional_kwargs?.functions_state_id
    )
      return true;
    return false;
  });
}

/** One primary attempt and at most one fallback model call; never wraps graph/tool execution. */
export class FallbackChatModel extends BaseChatModel {
  constructor(
    private readonly primary: BaseChatModel,
    private readonly fallback: BaseChatModel,
    private readonly primaryProvider: string,
    private readonly fallbackProvider: string,
    private readonly tools?: BindToolsInput[],
    private readonly toolOptions?: Partial<BaseChatModelCallOptions>,
  ) {
    super({ disableStreaming: true, maxRetries: 0 });
  }

  _llmType(): string {
    return 'direct-model-fallback';
  }

  private async run<T>(
    input: BaseLanguageModelInput,
    options: any,
    primary: Runnable<any, T>,
    fallback: Runnable<any, T>,
  ): Promise<T> {
    options.signal?.throwIfAborted();
    if (opaqueHistory(input, this.primaryProvider))
      throw new Error(
        'Provider-specific history cannot be sent to the configured primary',
      );
    try {
      const result = await primary.invoke(input, options);
      options.signal?.throwIfAborted();
      return result;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!isChatAvailabilityFailure(error)) throw error;
      // Preserve the original provider failure if this conversation cannot safely move.
      if (
        opaqueHistory(input, this.fallbackProvider) ||
        options.previousResponseId ||
        options.previous_response_id
      )
        throw error;
      logger.warn({
        event: 'chat_fallback',
        from: this.primaryProvider,
        to: this.fallbackProvider,
        reason: (error as Error).name,
        status: (error as any).status,
      });
      const result = await fallback.invoke(input, options);
      options.signal?.throwIfAborted();
      return result;
    }
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    manager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const primary = this.tools
      ? this.primary.bindTools(this.tools, this.toolOptions)
      : this.primary;
    const fallback = this.tools
      ? this.fallback.bindTools(this.tools, this.toolOptions)
      : this.fallback;
    const message = await this.run(
      messages,
      {
        ...options,
        callbacks: manager
          ? new CallbackManager(manager.runId, {
              handlers: manager.handlers,
              inheritableHandlers: manager.handlers,
            })
          : undefined,
      },
      primary,
      fallback,
    );
    return { generations: [{ text: message.text, message }] };
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions>,
  ): FallbackChatModel {
    return new FallbackChatModel(
      this.primary,
      this.fallback,
      this.primaryProvider,
      this.fallbackProvider,
      tools,
      kwargs,
    );
  }

  // Preserve the SDK overloads (including includeRaw) and provider-specific parsers.
  withStructuredOutput: BaseChatModel['withStructuredOutput'] = ((
    schema: any,
    config?: any,
  ): Runnable<any, any> => {
    const primary = this.primary.withStructuredOutput(schema, config);
    const fallback = this.fallback.withStructuredOutput(schema, config);
    return RunnableLambda.from((input: BaseLanguageModelInput, options) =>
      this.run(input, options ?? {}, primary, fallback),
    );
  }) as BaseChatModel['withStructuredOutput'];
}
