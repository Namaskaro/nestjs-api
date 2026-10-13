# AI configuration (Phase 2: chat transport compatibility)

Application code requests `AiService.getChatModel('FAST' | 'STANDARD')`.
The return type remains `ChatOpenAI` for structured output and tool calling.
`STRONG` is reserved in the type; requesting it throws and requires no env key.
There is no cross-provider fallback in this phase.

## Required independent selectors

```dotenv
CHAT_PROVIDER=yandex
EMBEDDING_PROVIDER=yandex
```

Both selectors are required and accept only `yandex` or `openai`. They are read
when `AiService` is constructed. Restart the application after configuration
changes. `AI_PROVIDER` no longer controls either path and is not a fallback.
Before upgrading, set `EMBEDDING_PROVIDER` to the provider used to build the
existing vectors (including deployments previously relying on the Yandex default).
Changing `CHAT_PROVIDER` then leaves embeddings unchanged.

Changing the embedding provider/model/dimensions itself still requires a separate
index migration. This change does not reindex or change retrieval.

## Chat model mapping

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

## Chat transport profiles

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
In this SDK, `useResponsesApi: false` is not a hard prohibition: Responses-only
call options or built-in tools can still trigger automatic selection. Current
application calls are covered and remain on Chat Completions; do not introduce
Responses-only options for Yandex without verifying endpoint support.

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

## Next boundary (not implemented)

LiteLLM can map the existing roles to `support-fast` / `support-standard` and
own fallback policy behind this facade. Keeping these choices inside `src/ai`
avoids coupling application callsites to future gateway routing.
A separate `ChatModelPort` is not required before an OpenAI-compatible LiteLLM
integration; reconsider it only if concrete SDK incompatibilities justify it.

Before adding the gateway, verify its Responses endpoint separately from Chat
Completions: explicit alias/profile mapping, reasoning and sampling parameters,
stateless encrypted reasoning/tool-result replay, structured output and refusal
envelopes, usage accounting and actual upstream model identity. One alias must
not silently fall back to a model with incompatible capabilities. A Responses
request cannot be assumed to work against a Chat Completions-only upstream.
Gateway endpoint configuration, fallback, budgets and deployment are not
implemented in Phase 2. Existing OpenAI requests still target OpenAI directly.

## Offline validation

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

### Verification limits

- Mock HTTP proves installed SDK serialization/normalization, not server-side
  acceptance, account access, production response quality or latency/cost.
- Strict-schema object requirements are checked on serialized application
  schemas, but this is not a complete server-side JSON Schema validator.
- Streaming, live Yandex behavior and gateway translation remain unverified.
- The installed Chat Completions converter drops a provider `message.refusal`
  field. Tests preserve its existing empty-result behavior. Responses retains
  refusal in `additional_kwargs.refusal`; neither case becomes parsed success.
- Truncated **partial JSON** is rejected while truncation metadata is retained.
  A syntactically complete, schema-valid payload marked `incomplete` is not given
  a new global rejection policy here. Any such policy requires an explicit
  follow-up decision covering raw calls, structured output and tool execution.
- No new infrastructure framework, schema/prompt rewrite, application graph
  change or provider fallback is included. Phase 3 requires separate approval.

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
