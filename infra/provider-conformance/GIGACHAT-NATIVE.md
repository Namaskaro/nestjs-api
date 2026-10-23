# GigaChat native adapter — offline conformance, live pending (2026-10-22)

Official npm packages are still `langchain-gigachat@0.0.18` and `gigachat@0.0.20`. The preserved official-adapter acceptance test has 7 failing leaf contracts: jsonMode, jsonSchema, Zod 4 function schemas, native function state history, graph tool schema, incomplete output, and aborting active HTTP. No failed assertion was disabled. It remains experimental, outside production CI.

GigaChat's OpenAI compatibility is partial: v1 uses native `functions`, object-valued function arguments and `functions_state_id`. Native structured output uses `response_format: { type: 'json_schema', schema, strict: true }`. Merely pointing ChatOpenAI at that URL does not satisfy existing contracts. [Official compatibility](https://developers.sber.ru/docs/ru/gigachat/guides/compatible-openai), [structured output](https://developers.sber.ru/docs/ru/gigachat/guides/structured-output).

The minimal provider-specific implementation is `src/ai/gigachat-model.ts`: one BaseChatModel, native message/function conversion, shared bounded OAuth token refresh, complete-response validation, and existing LangChain schema conversion + Zod validation. No dependency, service, middleware, business schema, prompt, or domain logic was added. We cannot reuse the official JS adapter's missing contracts or its non-abortable chat call without relying on internal Axios plumbing. Native Node fetch keeps cancellation and body reads bounded.

```dotenv
CHAT_FAST_PROVIDER=gigachat
CHAT_FAST_MODEL=GigaChat-2
CHAT_FAST_TRANSPORT_PROFILE=gigachat-native
GIGACHAT_CREDENTIALS=<Basic authorization key, not Bearer access token>
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_API_URL=https://api.giga.chat/v1
GIGACHAT_AUTH_URL=https://ngw.devices.sberbank.ru:9443/api/v2/oauth
NODE_EXTRA_CA_CERTS=<trusted CA PEM supplied by operator>
```

Alternatively `GIGACHAT_ACCESS_TOKEN` is supported for explicitly managed short-lived tokens. OAuth credentials are the preferred renewal mode. Token-only 401 requires replacement; it does not retry a model automatically. Required TLS verification stays enabled; never use NODE_TLS_REJECT_UNAUTHORIZED=0. CA-chain trust must be tested in the actual production image.

The role fallback keys use the same `gigachat` provider/model/profile vocabulary, but no fallback is enabled by default. **Do not enable a production GigaChat deployment until the live plan below and CA check pass.** Offline fixtures prove local protocol/validation/cancellation behavior, not the remote model's schema/tool capabilities.

Native v1 scope is text and one function call per model turn. Multimodal/opaque reasoning blocks and parallel function-call histories are explicitly rejected, never silently truncated. `jsonMode` uses native schema-constrained JSON because v1 has no OpenAI json_object mode. `jsonSchema` and functionCalling validate Zod 4 locally; includeRaw retains raw + parsed/null. Refusal/length/unknown/missing finish reason rejects before parsing or tool execution. No provider-output repair or LLM retries.

OAuth refresh is shared per deployment, renews before expiry, and has its own bounded fetch. A cancelled waiter cannot cancel another chat's refresh; the shared authentication request may finish after that waiter exits, but no cancelled chat model request is sent. Each chat shares one timeout across waiting for auth and reading the model body. No same-call model replay on 401; token is invalidated for the next independent request. Cold concurrent model requests share one OAuth request. Secrets are not included in HTTP diagnostics or telemetry.

Offline: `node --test src/ai/testing/gigachat-http.integration.cjs`. The same nine strict assertions from the official-adapter stand pass, plus OAuth expiry/concurrency, isolated abort, auth failure, preabort, refusal variants, completed-invalid Zod/includeRaw, HTTPS enforcement and stalled body tests. CA trust on a real endpoint remains a live gate.
