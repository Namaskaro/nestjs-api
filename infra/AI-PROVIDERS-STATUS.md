> **Исторический материал (до 26.10.2026).** Актуальные конфигурация, статусы, индексация и rollback: [AI_PROVIDERS.md](../docs/AI_PROVIDERS.md). Примеры Alibaba/OpenAI secondary и прежний CLI/prune ниже сохранены для истории и не являются текущей инструкцией запуска.

# Current AI provider status — 2026-10-23

Direct is the implementation. OpenAI Responses and Yandex/Qwen Chat Completions use ChatOpenAI; GigaChat native v1 uses DirectGigaChat. The official Giga SDK experiment remains incompatible and is not the runtime adapter. All are covered offline; none is newly certified for live production.

FAST/STANDARD select primary and optional fallback independently. Embeddings remain independent; optional Yandex → OpenAI → BM25 uses separate indices. Fallbacks require explicit configuration, and embedding failover defaults off. No LiteLLM runtime, budget DB or custom gateway is connected.

Current configuration: [README](../src/ai/README.md), [environment example](../src/ai/.env.example), [LLM fallback](CHAT-FAILOVER.md), [embedding failover and maintenance](EMBEDDING-FAILOVER.md), [Giga native contracts](provider-conformance/GIGACHAT-NATIVE.md), [verification/release gates](PRODUCTION-AI-REVIEW.md).

## Historical review before native Giga and E/F implementation

The snapshot below is preserved as research history. Its “not implemented” statements and test counts are not the current state.

# AI Provider Infrastructure — review 2026-10-22

Repository `Namaskaro/nestjs-api`, branch `refactor/ai-provider-abstraction`, unchanged HEAD `aff28c0ee5912047f524b16db9fd8a262606ecf2`. Local changes only; no paid calls, commit, push, merge or rebase.

## Executive summary

- Direct remains the target. Qwen was added through the existing ChatOpenAI transport without a new dependency or service. OpenAI/Yandex contracts remain green.
- GigaChat is **not enabled**: the official JS adapter fails mandatory application contracts. A strict, reproducible offline acceptance test is retained separately.
- Full Jest: **715/716 tests, 94/95 suites pass**. The remaining MI-03 test expects the Planner to write Memory, which the current model DTO explicitly excludes. Its assertion remains unchanged.
- Embeddings runtime was not changed. Local Qdrant contains usable BM25 vectors; sparse-only queries worked without an embedding API. The recommended bounded BM25 fallback is a proposal, not an implemented feature.
- No production-readiness claim: actual provider accounts/models, TLS/auth, quotas, live history and retrieval quality still need conformance testing.

Separate deliverables: [test results](AI-TEST-RESULTS.md), [embeddings research](EMBEDDINGS-RELIABILITY-RESEARCH.md), [review and rollback](GIT-REVIEW-ROLLBACK.md).

## Current infrastructure

`AiService.getChatModel('FAST' | 'STANDARD')` is unchanged. Each role independently selects a provider and model. Models are cached per role; changing configuration requires a process restart. `STRONG` remains reserved. Embedding selection still accepts only OpenAI/Yandex and is independent of chat selection.

The existing [AiService](../src/ai/ai.service.ts), [transport profiles](../src/ai/chat-transport.ts), [completion guard](../src/ai/chat-http.ts) and SDK provide routing, parameters, completion validation and a request timeout. Chat SDK retries stay zero. No application retry/deadline manager, gateway, fallback, custom authentication or database was added. LiteLLM remains [an experimental stand](litellm/MINIMAL-GATEWAY.md), outside runtime and ordinary Jest.

New production code in D is confined to two existing files: chat-provider selection in `ai.service.ts` and one Qwen profile in `chat-transport.ts`. No prompts, graph/domain models, Orders, Commerce or embedding methods were changed for provider support. B separately adds semantic-result validation; C retains the previously agreed Workspace fixes.

## Qwen

Use [src/ai/.env.example](../src/ai/.env.example). Set either `CHAT_FAST_PROVIDER` or `CHAT_STANDARD_PROVIDER` to `qwen`, set its explicit `CHAT_<ROLE>_MODEL`, and supply `QWEN_API_KEY` plus `QWEN_API_URL` for that account's workspace and region. There is no guessed endpoint/model fallback. `qwen-chat` is an optional explicit transport profile.

The profile uses Chat Completions with `enable_thinking:false`, temperature 0, buffered responses and the existing completion guard. The examples select `qwen3.7-flash-2026-07-15` and, as another suitable candidate, `qwen3.7-max-2026-06-08`. Official documentation lists non-thinking operation for these text deployments and JSON Schema support for the relevant family. This does **not** certify every Qwen model or every region. Thinking-only and Omni models are outside this profile. [Compatible API](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope), [thinking modes](https://www.alibabacloud.com/help/en/model-studio/deep-thinking), [structured output](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output).

Verified with the installed real SDK and mock HTTP responses:

| Contract | Evidence and limit |
| --- | --- |
| invoke / usage | Both roles; request fields, credentials, parsed usage, role cache |
| structured output | Default, functionCalling, jsonMode, jsonSchema; actual Workspace schema; valid/invalid Zod 4 and includeRaw |
| tool cycle | Tool-call IDs, result messages and subsequent model response; no repeated tool |
| LangGraph | Existing Customer Help graph, real tools, v3 streamEvents, two model sends |
| abort / timeout | Pre-abort zero sends; native socket closure on active abort; timeout during headers/body |
| error / completion | 401/429/500 single send; length/content_filter/unknown finish rejected; refusal gives no parsed plan |
| history | Same-provider text/tool history; OpenAI encrypted reasoning does not become Qwen text |

See [Qwen contracts](../src/ai/qwen.contract.spec.ts) and [native HTTP tests](../src/ai/testing/direct-http.integration.cjs). Local HTTP proves SDK/wire behavior, not a model's compliance. Required live checks include strict schema acceptance, tool selection, actual usage accounting, account permissions and latency.

Provider-specific reasoning is not portable. Existing OpenAI encrypted Responses history remains tested within OpenAI. The Qwen profile disables thinking and does not implement Qwen thinking-state replay. Do not switch an active checkpointed conversation between providers expecting invisible reasoning continuity; start a new conversation for conformance. Qwen's provider-specific history requirements are documented in its [function-calling guide](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling).

## GigaChat: blocked before application integration

Tested official `langchain-gigachat@0.0.18`, underlying `gigachat@0.0.20`, against this project's Core 1.2.8, Zod 4.4.3 and LangGraph 1.4.9. Installation is isolated under `.tmp/gigachat-compat`; project package/lock files are unchanged. Source: [official JS adapter](https://github.com/ai-forever/langchainjs/tree/main/libs/langchain-gigachat), [SDK](https://github.com/ai-forever/gigachat-js).

The [strict acceptance test](provider-conformance/gigachat.acceptance.cjs) uses a loopback server and native SDK requests. **2 of 9 subtests pass, 7 fail**; Node also counts the failed parent test. Failures stay failures, outside normal CI:

1. `jsonMode` and `jsonSchema` both throw before HTTP. The recommendation synthesizer needs jsonMode; changing application prompts/methods would exceed this integration's scope.
2. The adapter's Zod 3 conversion drops the properties of the project's Zod 4 function schema. A mock can return a parseable result, but the provider receives an invalid/incomplete tool contract.
3. Incoming `functions_state_id` is stored as `function_state_id`; outgoing conversion reads the plural field. Tool-result history loses provider state.
4. LangGraph events execute, but the actual tool schema on the wire has the same missing Zod fields. This is not a claim that all graph events are unsupported.
5. A `finish_reason:length` tool response is accepted, violating completed-response safety.
6. Abort rejects the caller but does not promptly close upstream HTTP; closure follows the independent SDK timeout. The ordinary timeout test passes.

Minimal next step: a compatible official adapter release covering these contracts, then rerun the same strict stand. No local SDK fork, auth manager, schema downgrade, completion shim or application rewrite was introduced.

Authentication needs the account's authorization credentials/scope or an access token; token lifetime is 30 minutes. Let the supported SDK handle OAuth refresh when integration becomes eligible. The acceptance stand uses a fixed offline token and does not certify OAuth-refresh send counts. Configure trusted CA certificates, e.g. `NODE_EXTRA_CA_CERTS` before Node starts; never disable certificate verification. The current API documentation also distinguishes the newer `https://api.giga.chat` endpoint from legacy accounts. Validate the account-specific API/auth URLs and SDK support before live use. [Official API/auth documentation](https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api), [adapter configuration](https://github.com/ai-forever/langchainjs/blob/main/libs/langchain-gigachat/README-ru_RU.md).

## Live smoke prepared, not executed

[provider-smoke.cjs](../src/ai/testing/provider-smoke.cjs) loads AiService, makes no database/index writes, and exposes only a local `smoke_ping` tool. It requires **both** `--live` and `ALLOW_PAID_LLM_SMOKE=1`; without them it exits 2 before loading the model. Syntax and this refusal path were checked. The entire 12-invocation flow also passed offline with fetch fully replaced by a denying-external-network fixture (`.tmp/smoke-offline-preload.cjs`); this is not a live provider result.

After explicit approval, supply private environment variables for both roles (example file is AI-only, not a replacement for the whole application's env). Embeddings need only their selector for this script; they are never called. For OpenAI/Qwen, normal trusted public TLS is used; any corporate TLS root must be supplied through the trust store. GigaChat is excluded until its blockers are resolved.

```powershell
node --env-file=<private-env-file> src/ai/testing/provider-smoke.cjs --live
```

The run makes at most **12 logical model invocations**: per role, invoke + three structured modes + a two-call tool cycle. Failures stop the run; no automatic retries. A planning estimate is a few thousand input tokens plus short visible outputs; reasoning can materially increase billed output. No hard output or monetary cap is claimed. Exact cost is `sum(input_tokens * regional_input_price + billed_output_tokens * regional_output_price) / tariff_unit`, using the selected account/model tariff. The script prints usage, not response bodies/credentials. A short requested answer is not a cost guarantee; approve the actual regional models/tariffs first.

Remaining application reliability concerns from the previous review (Planner repair classification, nested cancellation, Handoff retry) are not silently solved by this integration. They remain documented; no new phase was started.
