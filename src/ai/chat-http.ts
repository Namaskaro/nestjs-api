import type { ChatOpenAIFields } from '@langchain/openai';

type HttpFetch = NonNullable<
  NonNullable<ChatOpenAIFields['configuration']>['fetch']
>;
type Api = 'responses' | 'chat-completions';
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

/** Validate completion before LangChain parsing or tool execution; never rewrite output. */
export function assertCompletedChatResponse(body: RecordValue, api: Api): void {
  if (api === 'responses') {
    if (body.status !== 'completed' || body.error != null) {
      throw new Error(
        'Chat response is not completed (status: ' + String(body.status) + ').',
      );
    }
    if (
      !Array.isArray(body.output) ||
      body.output.some((item) => !record(item) || typeof item.type !== 'string')
    )
      throw new Error('Malformed Responses output.');
    if (
      body.output.some(
        (item) => item.status != null && item.status !== 'completed',
      )
    )
      throw new Error('Chat response contains an unfinished output item.');
    return;
  }
  const choices = body.choices;
  if (
    !Array.isArray(choices) ||
    !choices.length ||
    choices.some(
      (choice) =>
        !record(choice) ||
        !record(choice.message) ||
        !['stop', 'tool_calls', 'function_call'].includes(choice.finish_reason),
    )
  )
    throw new Error('Chat completion has no completed choice.');
}

/** SDK owns the timeout. Buffer inside its fetch call so it also bounds body reads. */
export function createChatFetch({ api }: { api: Api }): HttpFetch {
  return async (input, init) => {
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    if (
      !url.pathname.endsWith(
        api === 'responses' ? '/responses' : '/chat/completions',
      )
    )
      throw new Error('Unapproved chat API surface.');
    if (record(JSON.parse(String(init?.body)))?.stream === true)
      throw new Error(
        'Streaming chat is not enabled: completion safety requires a complete response.',
      );
    const response = await globalThis.fetch(input, init);
    signal?.throwIfAborted();
    // Buffer errors too: otherwise the SDK timeout would stop at error headers.
    const text = await response.clone().text();
    signal?.throwIfAborted();
    if (response.ok) {
      try {
        const body = record(JSON.parse(text));
        if (!body) throw new Error('Malformed chat response.');
        assertCompletedChatResponse(body, api);
      } catch (error) {
        const failure =
          error instanceof Error
            ? error
            : new Error('Malformed chat response.');
        failure.name = 'ChatTransportError';
        throw failure;
      }
    }
    // Preserve status, headers, bytes and provider error codes for the SDK.
    return response;
  };
}
