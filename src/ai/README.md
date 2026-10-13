# AI configuration (Phase 3: optional LiteLLM gateway)

Application code requests `AiService.getChatModel('FAST' | 'STANDARD')`.
The return type remains `ChatOpenAI` for structured output and tool calling.
`STRONG` is reserved in the type; requesting it throws and requires no env key.
Cross-provider fallback remains disabled. Full deployment instructions, test
results, compatibility matrix and limitations are in
[the Phase 3 gateway report](../../infra/litellm/README.md).

## Deployment mode

```dotenv
CHAT_MODE=direct
```

`direct` preserves the Phase 2 provider configuration below. An omitted
`CHAT_MODE` defaults to `direct` for compatibility; use an explicit value in new
deployments. Unknown values fail at construction.

Gateway mode instead requires:

```dotenv
CHAT_MODE=gateway
LITELLM_BASE_URL=http://127.0.0.1:4000/v1
LITELLM_API_KEY=<gateway virtual key>
EMBEDDING_PROVIDER=yandex
```

`FAST` maps to `support-fast`; `STANDARD` to `support-standard`. Both use Responses
API to the gateway. NestJS sends no chat reasoning/sampling overrides: the selected
gateway deployment owns those parameters and upstream credentials. It ignores
`CHAT_PROVIDER` and direct chat settings in this mode. `EMBEDDING_PROVIDER` and
its existing credentials/models remain independently required. No index migration
or automatic embedding switch follows a gateway/provider change.

The base URL must end in `/v1`, use HTTP(S), and contain no credentials, query or
fragment. Gateway key/URL are validated lazily on first chat use. Gateway requests
have a 70-second client timeout, zero SDK retries and no application fallback.

## Direct mode: required independent selectors

```dotenv
CHAT_PROVIDER=yandex
EMBEDDING_PROVIDER=yandex
```

In direct mode both selectors are required and accept only `yandex` or `openai`. They are read
when `AiService` is constructed. Restart the application after configuration
changes. `AI_PROVIDER` no longer controls either path and is not a fallback.
Before upgrading, set `EMBEDDING_PROVIDER` to the provider used to build the
existing vectors (including deployments previously relying on the Yandex default).
Changing `CHAT_PROVIDER` then leaves embeddings unchanged.

Changing the embedding provider/model/dimensions itself still requires a separate
index migration. This change does not reindex or change retrieval.

## Direct mode: chat model mapping

| Provider | Role | Required model key |
| --- | --- | --- |
| Yandex | FAST | `YANDEX_LITE_MODEL` |
| Yandex | STANDARD | `YANDEX_MODEL` |
| OpenAI | FAST | `OPENAI_FAST_MODEL` |
| OpenAI | STANDARD | `OPENAI_STANDARD_MODEL` |

Yandex chat also needs `YANDEX_API_KEY` and `YANDEX_API_URL` (the existing
OpenAI-compatible endpoint). OpenAI chat needs `OPENAI_API_KEY`.
`OPENAI_CHAT_MODEL` and its implicit default are no longer used.
For the target OpenAI deployment, set:

```dotenv
CHAT_PROVIDER=openai
OPENAI_FAST_MODEL=gpt-6-luna
OPENAI_STANDARD_MODEL=gpt-6.1-sol
```

Supply `OPENAI_API_KEY` separately and keep `EMBEDDING_PROVIDER` and its existing
settings explicit. Model availability for the deployment's account has not been
verified with live API calls.

Models are created on first request and cached per role. Missing/blank model IDs,
keys or endpoint settings produce configuration errors on that first request.
Only the selected provider is initialized. Role/provider/configured model are
attached as tags and metadata to the existing `llmUsageCallback`; retries,
structured-output schemas, prompts and tool wiring are unchanged.

## Direct mode: chat transport profiles

`chat-transport.ts` owns the small, explicit deployment policy. Application roles
still select configured model IDs; they do not determine a model's capabilities.

| Deployment | API | Reasoning effort | Temperature |
| --- | --- | --- | --- |
| Yandex, either role | Existing Chat Completions endpoint | Not sent | `0` |
| OpenAI `gpt-6-luna` | Responses | `none` | `0` |
| OpenAI `gpt-6.1-sol` | Responses | `medium` | Omitted |

Sol requires Responses for tool calling and does not support effort `none`.
Luna supports `none`; using Responses for both OpenAI profiles keeps the transport
policy small. `medium` is Sol's documented default, not a latency/quality setting
calibrated against this application. Effort and temperature remain independent
parameters. Sol requests also omit `top_p`, `top_logprobs` and `logprobs`.

The exact two OpenAI model IDs above select their matching profiles automatically.
Custom deployment IDs (including snapshots or aliases) require an explicit key:

```dotenv
OPENAI_FAST_TRANSPORT_PROFILE=gpt-6-luna
OPENAI_STANDARD_TRANSPORT_PROFILE=gpt-6.1-sol
```

These keys are optional for the exact known IDs. Only the two listed profile
values are accepted. A profile that contradicts an exact known model ID is an
error. An unknown model without a profile fails at first use; there is no prefix
guessing or default capability assumption. The model ID sent to the provider is
always the configured `OPENAI_*_MODEL` value. Assign a profile to a custom ID only
after verifying that the deployment supports it. A role can use either profile.
Yandex does not read these OpenAI profile settings.

Verified installed dependencies: `@langchain/openai` 1.5.6, `@langchain/core` 1.2.8,
and `openai` 6.46.0. The installed LangChain reasoning-model detector recognizes
older model names but omits GPT-6 and arbitrary aliases. Setting only the SDK's
top-level `reasoning` option would silently omit reasoning from these requests.
The helper therefore sends `modelKwargs.reasoning` explicitly. HTTP contract tests
cover this workaround; revisit it when upgrading the SDK.

OpenAI uses the SDK's `zdrEnabled: true` option to send `store: false` and replay
conversation items without depending on server-stored response IDs. Requests
include `reasoning.encrypted_content` so tool loops can replay returned reasoning
items. This SDK flag does **not** enable account-level Zero Data Retention.
`maxRetries: 0`, usage callbacks, tags and metadata are preserved.

Yandex explicitly retains `useResponsesApi: false` and `streamUsage: false`.
In this SDK, `useResponsesApi: false` alone is not a hard prohibition:
Responses-only options can trigger automatic selection. The Phase 3 HTTP guard
now rejects a switch to an unapproved API surface before sending HTTP. Current
application calls remain on Chat Completions.

Official references checked for Phase 2:

- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [Latest model guide](https://developers.openai.com/api/docs/guides/latest-model)
- [Deployment checklist](https://developers.openai.com/api/docs/guides/deployment-checklist)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [LangChain OpenAI integration](https://docs.langchain.com/oss/javascript/integrations/chat/openai)

The version-specific behavior above was also checked in installed SDK source;
current online SDK documentation alone does not establish installed behavior.

## Embeddings

Existing embedding settings retain their meaning:

| Provider | Required keys | Optional dimensions (existing default) |
| --- | --- | --- |
| Yandex | `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `YANDEX_EMBEDDING_QUERY_MODEL`, `YANDEX_EMBEDDING_DOCUMENT_MODEL` | `YANDEX_EMBEDDING_DIMENSIONS` (768) |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL` | `OPENAI_EMBEDDING_DIMENSIONS` (1536) |

Query, document and document-batch methods all use `EMBEDDING_PROVIDER`.
Yandex retains its query/document model pair; OpenAI retains its common model.
Credentials and model settings are validated when the operation is requested.
The raw OpenAI embedding client is lazy and reused, so Yandex-only deployments
do not require an OpenAI key. Unused eager OpenAI/Yandex DI clients were removed;
`AiModule` exports only `AiService`.

Mixed configuration is supported: `CHAT_PROVIDER=openai` with
`EMBEDDING_PROVIDER=yandex` needs OpenAI chat settings plus Yandex embedding
settings, but no `YANDEX_API_URL`, `YANDEX_MODEL` or `YANDEX_LITE_MODEL`.
The inverse combination is also supported.

Provider-specific embedding methods remain infrastructure implementation details
for compatibility; application callers should use the three neutral methods above.

## Completion safety and usage in both modes

`chat-http.ts` checks successful HTTP envelopes before SDK normalization, parsing
or tool execution. Responses must be completed with no error or unfinished output
item. Chat Completions choices require a recognized completed finish reason.
An incomplete response is rejected even if its JSON/tool arguments satisfy a
schema. The SDK wraps this fetch error; inspect `cause.name=ChatTransportError`
and `cause.chatTransport` for correlation. HTTP provider errors retain their
status; abort errors retain their identity and signal. Original response bytes
are passed through after the guard; Zod/domain validation is preserved.

This guard supports non-streaming HTTP. `disableStreaming: true` in both modes
also prevents graph event callbacks from implicitly turning `invoke` into provider
streaming. Graph v3 events and tool loops remain functional with completed model
output; token deltas are not emitted as they arrive from the provider. Explicit
wire `stream: true` fails before HTTP. Completed refusals and invalid
raw tool arguments remain available to the existing SDK/parser behavior without
inventing structured success. Yandex refusal fields can be lost in conversion.

LiteLLM can lose a missing/null upstream CC finish reason by normalizing it to
`stop`. The application cannot recover that evidence from the bridged response;
the gateway report documents this limitation. Known incomplete and unknown
non-null reasons are covered by explicit guards/tests.

The existing `llm_call` callback is preserved. In gateway mode its scope is
`logical_call`; separate `llm_gateway_request` and `llm_gateway_deployment` events
describe HTTP requests and physical attempts. Do not sum these levels. Unknown
cost remains null. Physical gateway accounting, optional PostgreSQL virtual keys,
verified-pricing requirements and budget limits are detailed in the gateway report.

## Offline validation — Phase 3

Based on published Phase 2 commit `fd1337d3c952c6c8ff299998d8d4a453304058d7`.
157 tests passed across 12 selected Jest suites, plus 38 integration tests against
real pinned LiteLLM with local mock providers and disposable PostgreSQL, plus
5 Python policy tests. See the gateway report for commands and exact scope.
Before the approved Phase 3 publication, TypeScript compilation passed with
`tsc --noEmit --incremental false -p tsconfig.build.json` (spec files excluded).
No paid/live provider call, full repository suite or emitting Nest build was run.
Jest uses isolated transpilation independently of that compilation check.
Embedding methods and business files are unchanged. Production budgets and
cross-provider fallback have not been approved by these offline results.

## Historical offline validation — Phase 2

Phase 2 was developed on `987333b7ea303d0597557d4916dcfc0bdd372b98`.
The 10 selected suites contain 124 passing tests: 17 transport-profile tests,
37 HTTP contract tests, and the 70 existing passing tests selected in Phase 1.
The final contract suite was rerun after adding seven cases to the earlier
117-test, 10-suite passing run. No claim is made about the full repository suite.

HTTP tests instantiate real `ChatOpenAI`, OpenAI SDK, Runnable and Zod code;
only HTTP responses are mocked. They inspect serialized requests and normalize
Chat Completions/Responses envelopes. Coverage includes all four deployments,
JSON mode, default structured output, `includeRaw`, invalid tool arguments,
refusal, partial/truncated JSON, HTTP errors without retries, tool-result replay,
callback usage/tags/metadata, the actual Router/Handoff/Enrichment schemas,
workspace normalization/repair and the CustomerHelp graph's tool loop.

Existing passing suites additionally cover role mapping, isolated `AiModule`
bootstrap with mocked Prisma, lazy initialization, credential isolation,
query/document/batch embeddings, usage accounting, recommendation, router
corrections, deterministic aggregation, the legacy model adapter and semantic
enrichment. Embedding implementation and application code were not changed.

No live LLM calls, paid requests, database access/mutations, reindexing, build or
separate TypeScript-only check were performed in Phase 2. The repository's Jest
configuration uses isolated transpilation; these results are not a full typecheck.

### Historical Phase 2 verification limits

- Mock HTTP proves installed SDK serialization/normalization, not server-side
  acceptance, account access, production response quality or latency/cost.
- Strict-schema object requirements are checked on serialized application
  schemas, but this is not a complete server-side JSON Schema validator.
- Streaming, live Yandex behavior and gateway translation were unverified in Phase 2.
- The installed Chat Completions converter drops a provider `message.refusal`
  field. Tests preserve its existing empty-result behavior. Responses retains
  refusal in `additional_kwargs.refusal`; neither case becomes parsed success.
- Truncated **partial JSON** is rejected while truncation metadata is retained.
  A syntactically complete, schema-valid payload marked `incomplete` is not given
  a new global rejection policy in Phase 2. The authorized Phase 3 now adds that
  rejection before raw calls, structured parsing and tool execution.
- No new infrastructure framework, schema/prompt rewrite, application graph
  change or provider fallback was included in Phase 2. Phase 3 was separately
  authorized and is documented above.

### Historical Phase 1 baseline (not rerun in Phase 2)

At Phase 1 base `fec0fdb4d2e0952802a786de4a10f6557c78b101`, three existing suites
failed: `product-workspace.spec.ts` (24 tests),
`product-multi-action-cross-domain.spec.ts` (5 tests), and
`product-workspace-model-plan-tolerance.spec.ts` (1 test; 5 pass).
The same failures were reproduced on a clean export of that exact commit with
the same dependencies. Workspace fixtures use a legacy `decision.proposal`
shape; the tolerance assertion expects `training` where normalization returns
`running`. These historical results are not a fresh Phase 2 baseline validation;
the failing suites and corresponding business logic remain outside this patch.
