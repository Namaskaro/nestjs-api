> **Исторический материал (до 26.10.2026).** Актуальные конфигурация, статусы, индексация и rollback: [AI_PROVIDERS.md](../docs/AI_PROVIDERS.md). Примеры Alibaba/OpenAI secondary и прежний CLI/prune ниже сохранены для истории и не являются текущей инструкцией запуска.

# Direct chat failover — review candidate (2026-10-22)

`AiService.getChatModel('FAST' | 'STANDARD')` remains a BaseChatModel. Fallback is absent unless configured independently for that role.

```dotenv
CHAT_MODE=direct
CHAT_FAST_PROVIDER=yandex
CHAT_FAST_MODEL=gpt://<folder>/<approved-model>
CHAT_FAST_FALLBACK_PROVIDER=qwen
CHAT_FAST_FALLBACK_MODEL=qwen3.7-flash-2026-07-15
CHAT_STANDARD_PROVIDER=openai
CHAT_STANDARD_MODEL=gpt-6.1-sol
CHAT_STANDARD_FALLBACK_PROVIDER=qwen
CHAT_STANDARD_FALLBACK_MODEL=qwen3.7-flash-2026-07-15
CHAT_REQUEST_TIMEOUT_MS=60000
QWEN_API_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_API_KEY=<environment secret>
```

Supply existing Yandex/OpenAI credentials as usual. The Qwen Flash snapshot is listed with tools/structured-output support in the [official model table](https://help.aliyun.com/en/model-studio/vision-model/). qwen3.7-max-2026-06-08 remains a separate live-conformance candidate, not a certified substitute. These Qwen deployment IDs require target-region/account availability and live conformance. For custom OpenAI model IDs set `CHAT_<ROLE>_TRANSPORT_PROFILE` and/or `CHAT_<ROLE>_FALLBACK_TRANSPORT_PROFILE` to `gpt-6-luna` / `gpt-6.1-sol`. Qwen uses `qwen-chat` (non-thinking); Yandex `yandex-chat`. Native GigaChat uses `gigachat-native`; see its separate notes. Missing fallback model/credentials is a configuration error; no implicit provider is selected.

## Exact boundary

`chat-fallback.ts` wraps **one model invocation**, never an agent, graph, tool, order or mutation. There are at most two model HTTP sends: one primary, one fallback; both SDK retry counts are zero. `bindTools`, `withStructuredOutput` and `includeRaw` delegate to each provider's own adapter. A parser/validation error does not qualify for fallback. The wrapper preserves callback parentage and graph events; SDK requests remain buffered until completion validation. No user-visible socket event changed.

Installed LangChain core 1.2.8 `withFallbacks` returns a generic Runnable, has no exception allowlist and cannot itself preserve the full BaseChatModel API. The small BaseChatModel wrapper is the reason for an explicit equivalent here; there is no new agent framework or global retry manager.

Availability allowlist: HTTP 408/500/502/503/504; explicit rate-limit 429 codes; SDK request timeout; specific socket/connectivity error codes. Never switch on caller/node cancellation, auth, quota/billing, unknown 429, TLS/configuration, incomplete/refusal, malformed completion or structured output. LangChain 1.5.6 maps its SDK timeout to `TimeoutError: Request timed out.`; that exact mapping is covered. Original errors are retained when fallback is ineligible; if the fallback itself fails its error propagates. Logs contain provider/status, not prompts or secrets.

Each attempt uses its existing configured SDK timeout. A caller's AbortSignal/deadline is shared across both attempts and prevents the second send after cancellation. With no caller deadline the maximum model wait is two per-request timeouts. No new global deadline, node timeout change, graph cancellation integration or automatic repair was added. Existing LangGraph nested cancellation limitations are not claimed fixed by this task.

OpenAI encrypted/reasoning blocks cannot go to another provider. GigaChat functions_state_id cannot go to another provider. A prior Responses ID blocks fallback. History is not stripped or fabricated; the original availability error is returned if safe transfer is impossible. Fresh history may switch; already completed tools are sent only as history, never executed by this wrapper. No sticky routing or provider-managed conversation ID is introduced.

## LiteLLM decision

Stock **1.106.2**, released 2026-10-21, was exercised in a real isolated container with mock upstream, without Python hooks. Image ID: `sha256:0e5340fc3d4dee8ca7c0ecbea798714f2493b15085e171527267ef9bb480fcd9`.

The strict completion subset still fails: 16 leaf cases, 4 pass and 12 fail (Node reports 17 tests / 13 failures including the failed parent). Null/missing/unknown finish_reason is normalized into an accepted response in the Yandex role permutations. content_filter cases reject. The full compatible gateway matrix was not rerun after this decisive blocker. The experimental 1.105.1 default remains unchanged; runtime gateway remains disconnected. The temporary 1.106.2 container was stopped/removed after verification.

Reproduce: set `LITELLM_TEST_IMAGE=ghcr.io/berriai/litellm:v1.106.2`, start `infra/litellm/compose.conformance.yaml`, set `STOCK_CASE_FILTER=unconfirmed finish_reason`, run `node --test infra/litellm/tests/stock.integration.cjs`. This experimental suite is outside required production CI. [Release](https://github.com/BerriAI/litellm/releases/tag/v1.106.2).

## Rollback

Remove `CHAT_<ROLE>_FALLBACK_*` to return that role to primary-only immediately on application restart/config reload. Code rollback F removes only the wrapper/config wiring and its tests/notes. No stored business state is changed. Provider-specific reasoning in already persisted conversations still belongs to that provider; changing provider config does not migrate those conversations.
