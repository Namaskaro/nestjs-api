> **Исторический материал (до 26.10.2026).** Актуальные конфигурация, статусы, индексация и rollback: [AI_PROVIDERS.md](../docs/AI_PROVIDERS.md). Примеры Alibaba/OpenAI secondary и прежний CLI/prune ниже сохранены для истории и не являются текущей инструкцией запуска.

# Production AI Provider & Embedding Failover — pre-commit review, 2026-10-23

## Final cleanup

Disabled embedding failover preserves the original product PG projection and adds no catalog/completeness reads. Enabled failover shares five-second per-process source/completeness snapshots, invalidated around local index writes; this avoids a full scan for every concurrent search. Cross-replica updates and in-flight checks remain explicitly limited as described in [Embedding failover](EMBEDDING-FAILOVER.md). Missing optional secondary collections no longer block primary updates. Cleanup is separately opt-in, requires an exact collection and bounded deletion limit, rejects empty/mismatched sources, and deletes only inspected IDs.

Semantic validation B now tests the actual Responses SDK and indexing entry point without constructing Direct AiService. README, environment examples and provider status match the implemented OpenAI/Yandex/Qwen/Giga adapters; earlier reports are marked historical. LiteLLM remains an experimental acceptance stand outside production and ordinary CI.

Fresh reconstruction from `fec0fdb4` plus the published provider foundation and A–F, B-before/after-A checks, full regression runs and independent rollback checks are recorded in `.tmp/precommit-review/manifest.json`, `test-results.json` and `rollback-results.json`. Earlier artifacts under `.tmp/production-review` and `.tmp/final-integration-audit-20261023` remain unchanged. No commits or data migrations are performed by this cleanup.

Final cleanup verification: **748 Jest tests passed / 1 known MI-03 failure**, 98/99 suites; **100/100 native HTTP tests passed** (Node counts include parent tests). Build TypeScript and full tracked/untracked diff whitespace checks passed. B passed both before and after A (2/2 tests and TypeScript in each tree). Separate B/C/D/E/F rollback copies all compile and pass their remaining native HTTP suites; C rollback intentionally restores the same 68 baseline failures, while the other variants retain only MI-03. No new failing case appeared relative to the integration audit. Direct and Phase 4 backup hashes were reverified.

Branch `refactor/ai-provider-abstraction`; unchanged HEAD `aff28c0ee5912047f524b16db9fd8a262606ecf2`. Work is local and uncommitted. No paid model calls, real DB/Qdrant mutations, reindex, merge or push. Existing Direct and Phase 4 backups are retained; an additional verified pre-task snapshot is in `.tmp/production-failover-before`.

## What is implemented

- Configurable primary/fallback independently for FAST and STANDARD; one model call can fail over once on an explicit availability allowlist. Existing tools/structured output/events remain supported. No graph/tool/mutation replay. [Configuration and semantics](CHAT-FAILOVER.md).
- OpenAI Responses, Yandex Chat Completions and Qwen direct adapters retained. GigaChat has one isolated native v1 text adapter because current official JavaScript packages fail required local contracts. [GigaChat limits and configuration](provider-conformance/GIGACHAT-NATIVE.md).
- Opt-in Yandex primary + OpenAI secondary embeddings use separate collections; both down permits BM25 when the authoritative sparse index is complete. Bounded requests, typed failures, source fingerprints, dual writes, explicit manual reconciliation and rollback plan. [Embedding configuration and migration](EMBEDDING-FAILOVER.md).
- No new service, queue, global retry/deadline manager, budget DB, Python runtime hook or gateway. No Prisma schema, embedding-space mixing, Orders/Commerce/Handoff/frontend changes. Necessary application edits are limited to existing indexing/search entry points; public response/port schemas and hard-filter rules are unchanged.

Stock LiteLLM 1.106.2 still accepts null/missing/unknown finish_reason after normalization. A real container/mock upstream reproduced 12 failing leaf cases in the strict completion subset; gateway stays experimental and disconnected.

## Production gates and live plan — NOT EXECUTED

All four providers pass their implemented **offline** contracts; none receives a new claim of live production compatibility from these mocks. No deployment/fallback is enabled automatically. Production enablement requires account/region/model access, schema compatibility with the actual project schemas, response quality, latency, and TLS verification.

| Provider | Required credentials/deployment | Minimal approved live calls |
| --- | --- | --- |
| OpenAI | Project API key; access to gpt-6-luna and gpt-6.1-sol; approved organization/project residency and endpoint | Per model: plain response, ProductWorkspaceModelPlan JSON Schema + includeRaw, semantic JSON Schema with explicit Zod validation, JSON-mode consultation schema, two-turn tool loop, two-turn Responses reasoning history, one deliberately bounded output. Up to 9 model requests/model. |
| Yandex | API key + folder + exact approved Chat Completions model URI; target cloud region/endpoint | Same core schema/tool/short-output checks without OpenAI opaque reasoning: up to 7 requests/model. Confirm actual aliases and supported schema subset. |
| Qwen | DashScope API key for the chosen region, matching endpoint and model availability; candidate qwen3.7-flash-2026-07-15 / qwen3.7-max-2026-06-08 | Up to 7 requests/model; verify non-thinking flag, real tools/result history and JSON Schema. Intl/Singapore endpoint in examples must match the account; do not infer cross-region entitlement. |
| GigaChat | Authorization key; PERS/B2B/CORP scope; GigaChat-2 / approved Pro/Max model; trusted CA PEM in deployment image | Up to 7 requests/model + token issuance/refresh. Verify native schema subset against actual Workspace/semantic schemas, function arguments + functions_state_id, token renewal and TLS chain. Native v1 only; no parallel/multimodal-history claim. |

Use the actual existing `get_product_details` tool with approved read-only fixture product IDs and its real Zod schema, then send the ToolMessage result back to the same model. No order/cancel/handoff/memory-write tools are needed for this check. Keep conversation/graph state disposable and use the read-only service dependency. Tests must reject incomplete output before executing tools. Refusal/cancellation/error injection remains deterministic offline; a provider need not be induced to return every error live.

For two OpenAI, one Yandex, two Qwen and one Giga model, the above budget is **up to 46 model requests**, plus Giga auth and **3 embedding requests** (Yandex query + document, one OpenAI embedding batch) to confirm dimensions and query/document pairing. Request count is not a monetary estimate; token limits and actual provider tariffs/account budgets must be approved before running. These are maximum planned counts, not calls already made.

Qdrant 1.17.0 migration remains separately blocked on explicit permission for snapshots/writes/paid indexing. Existing primary vectors lack reliable producer provenance: a 768-element vector is not proof of the configured Yandex model. The controlled reindex and exact dense/sparse completeness checks must finish before serving failover. Related metadata changes that bypass product indexing and interrupted writes require explicit reconciliation; there is no claim of distributed atomicity.

## Simultaneous failure

Both LLM deployments unavailable: the model call returns an error; no tools/graph are replayed. Both embedding providers unavailable: current BM25 can serve search; if sparse coverage is incomplete, search fails explicitly. Qdrant unavailable: retrieval fails, not an empty catalog. PostgreSQL remains the source for later reconciliation. If LLM semantic extraction also failed during product indexing, new products require reconciliation after model recovery before their sparse text exists.

## Historical verification — 2026-10-22 implementation snapshot

- Full repository Jest: **736 passed / 1 known failure**, 98/99 suites. The remaining failure is `MI-03 gender, brand, size and wedding goal stay in their own SearchSpec/Memory`, `product-workspace.spec.ts:537`, expected wedding goal absent from Memory. It is the previously reproduced application baseline; Planner Memory ownership was not restored.
- Native HTTP with actual SDKs and local upstream: **100/100 passed**, including parent tests; Direct transport, embeddings, Yandex/OpenAI→Qwen fallback, Giga native/OAuth contracts. Zero external provider calls.
- TypeScript build typecheck and `git diff --check`: passed.
- Experimental stock LiteLLM acceptance remains red by design of the unchanged strict assertions; not included in ordinary Jest/production CI. Official Giga SDK acceptance remains archived and red; the new native adapter passes separate equivalent assertions.
- Source patches and rollback variants are verified on exported HEAD under `.tmp/production-review`, never by resetting or switching the working branch. See that manifest and `infra/PRODUCTION-GIT-REVIEW.md` for exact files/hashes/checks.

Runtime application cancellation through every nested graph remains a separate task: optional signals exist at model/embedding boundaries, but this work does not claim Phase 5 context propagation or durable socket cancellation. No new phase was started.
