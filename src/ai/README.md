# AI configuration (Phase 1)

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
Supply the exact model IDs enabled in the deployment. The proposed OpenAI
deployment values are `gpt-6-luna` and `gpt-6.1-sol`, respectively; their availability
and capabilities have not been verified with live API calls in this phase.

Models are created on first request and cached per role. Missing/blank model IDs,
keys or endpoint settings produce configuration errors on that first request.
Only the selected provider is initialized. Role/provider/configured model are
attached as tags and metadata to the existing `llmUsageCallback`; retries,
structured-output schemas, prompts and tool wiring are unchanged.

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
own fallback policy behind this facade. Application callsites need no change.
A separate `ChatModelPort` is not required before an OpenAI-compatible LiteLLM
integration; reconsider it only if concrete SDK incompatibilities justify it.

## Offline validation

The targeted suites cover role mapping, isolated `AiModule` bootstrap with mocked
Prisma, provider/credential isolation, query/document/batch embeddings, existing
usage accounting, workspace raw-output normalization/repair, recommendation,
router corrections, deterministic aggregation and the legacy model adapter.
No live LLM, paid API, database mutation, reindex or application build is needed.

At base `fec0fdb4d2e0952802a786de4a10f6557c78b101`, three existing suites already
fail: `product-workspace.spec.ts` (24 tests),
`product-multi-action-cross-domain.spec.ts` (5 tests), and
`product-workspace-model-plan-tolerance.spec.ts` (1 test; 5 pass).
The same failures were reproduced on a clean export of that exact commit with
the same dependencies. Workspace fixtures use a legacy `decision.proposal`
shape; the tolerance assertion expects `training` where normalization returns
`running`. These are outside this commit's scope. The other eight targeted
suites pass (70 tests); overall targeted results are 75 passed / 30 pre-existing
failures. A focused AI TypeScript check with `--noEmit` also passes.
