import { Logger } from '@nestjs/common';
import type { ChatOpenAIFields } from '@langchain/openai';
import { randomUUID } from 'node:crypto';

type HttpFetch = NonNullable<
  NonNullable<ChatOpenAIFields['configuration']>['fetch']
>;
type RecordValue = Record<string, unknown>;
const logger = new Logger('ChatTransport');

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object'
    ? (value as RecordValue)
    : undefined;
}

function number(value: unknown): number | null {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim() === '')
  )
    return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Check the transport envelope before any parser or tool executor sees it. */
export function assertCompletedChatResponse(
  body: RecordValue,
  api: 'responses' | 'chat-completions',
): void {
  if (api === 'responses') {
    if (body.status !== 'completed' || body.error != null) {
      throw new Error(
        `Chat response is not completed (status: ${String(body.status)}).`,
      );
    }
    if (!Array.isArray(body.output))
      throw new Error('Malformed Responses output.');
    if (
      body.output.some((item) => {
        const status = record(item)?.status;
        return (
          status !== undefined && status !== null && status !== 'completed'
        );
      })
    )
      throw new Error('Chat response contains an unfinished output item.');
    return;
  }
  const choices = body.choices;
  if (
    !Array.isArray(choices) ||
    choices.length === 0 ||
    choices.some(
      (choice) =>
        !['stop', 'tool_calls', 'function_call'].includes(
          String(record(choice)?.finish_reason),
        ),
    )
  )
    throw new Error('Chat completion has no completed choice.');
}

/**
 * No response rewriting: the original bytes reach LangChain after this guard.
 * A separate gateway event describes an HTTP request, never a provider attempt.
 */
export function createChatFetch(context: {
  mode: 'direct' | 'gateway';
  role: 'FAST' | 'STANDARD';
  api: 'responses' | 'chat-completions';
}): HttpFetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url,
    );
    const suffix =
      context.api === 'responses' ? '/responses' : '/chat/completions';
    if (!url.pathname.endsWith(suffix))
      throw new Error('Unapproved chat API surface.');
    const request = record(JSON.parse(String(init?.body)));
    if (request?.stream === true) {
      throw new Error(
        'Streaming chat is not enabled: completion safety is verified for non-streaming calls only.',
      );
    }
    const gatewayRequestId = context.mode === 'gateway' ? randomUUID() : null;
    const headers = new Headers(init?.headers);
    if (gatewayRequestId) headers.set('x-litellm-call-id', gatewayRequestId);
    const startedAt = Date.now();
    let response: Response | undefined;
    let body: RecordValue | undefined;
    let status = 'error';
    try {
      response = await globalThis.fetch(input, { ...init, headers });
      if (response.ok) {
        body = record(await response.clone().json());
        if (!body) throw new Error('Malformed chat response.');
        assertCompletedChatResponse(body, context.api);
        status = 'success';
      }
      // Preserve provider HTTP errors for the SDK, including their status/code.
      return response;
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error('Chat transport failed.');
      // Preserve fetch/network/abort error identity and the original signal.
      if (response?.ok && failure.name !== 'AbortError') {
        failure.name = 'ChatTransportError';
      }
      Object.assign(failure, {
        chatTransport: {
          gatewayRequestId,
          responseId: body?.id ?? null,
          responseStatus: body?.status ?? null,
        },
      });
      throw failure;
    } finally {
      if (context.mode === 'gateway') {
        const usage = record(body?.usage);
        logger.log(
          JSON.stringify({
            event: 'llm_gateway_request',
            usageScope: 'gateway_request',
            status,
            gatewayRequestId,
            gatewayReportedRequestId:
              response?.headers.get('x-litellm-call-id') ?? null,
            responseId: body?.id ?? null,
            responseStatus: body?.status ?? null,
            role: context.role,
            alias: request?.model ?? null,
            actualProvider: response?.headers.get('x-support-provider') ?? null,
            actualModel: response?.headers.get('x-litellm-model-name') ?? null,
            deploymentId: response?.headers.get('x-litellm-model-id') ?? null,
            httpStatus: response?.status ?? null,
            durationMs: Date.now() - startedAt,
            inputTokens: number(usage?.input_tokens),
            outputTokens: number(usage?.output_tokens),
            totalTokens: number(usage?.total_tokens),
            // Missing/unpriced cost stays unknown. Do not use cost-* subheaders,
            // which LiteLLM can populate with 0 even when total cost is unknown.
            costUsd:
              response?.headers.get('x-support-cost-status') ===
              'gateway-estimate'
                ? number(response.headers.get('x-litellm-response-cost'))
                : null,
            retries: number(
              response?.headers.get('x-litellm-attempted-retries'),
            ),
            fallbacks: number(
              response?.headers.get('x-litellm-attempted-fallbacks'),
            ),
            // Counts/causes of physical attempts belong to gateway deployment logs.
          }),
        );
      }
    }
  };
}
