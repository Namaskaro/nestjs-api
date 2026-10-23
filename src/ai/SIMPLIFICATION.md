> HISTORICAL SNAPSHOT — preserved research/results, not current deployment instructions. Final pre-commit cleanup (2026-10-23) supersedes runtime/status claims below; see [current configuration](README.md).

# Direct provider simplification — review report

2026-10-15. Branch: `refactor/ai-provider-abstraction`.
Published HEAD is unchanged: `aff28c0ee5912047f524b16db9fd8a262606ecf2`.
No commit, push, merge, rebase or Phase 5 work was performed.

## Result

AiService directly constructs a model for each role. New role-specific provider,
model and transport-profile settings take precedence over the documented legacy
fallbacks; invalid explicit settings fail. Embedding selection and implementation
are unchanged. Config changes require restart. There is no automatic fallback.

Kept the existing LangChain BaseChatModel contract rather than introducing an
interface. Current OpenAI-compatible clients still provide structured output,
Zod, includeRaw, tools, reasoning history, callbacks and graph events. Native
provider adapters can fit the return type but must pass these feature contracts
before being added. Qwen/GigaChat were not implemented.

The small HTTP guard keeps raw completion checks and cancellation, including late
result rejection. The existing SDK owns a configurable per-request timeout
(default 60 seconds) and zero retries. Buffering success AND error bodies inside
the SDK fetch keeps both within that timer. No manager or shared deadline exists.

## Compatibility matrix

| FAST | STANDARD | Credentials, endpoint, structured output |
| --- | --- | --- |
| Yandex | OpenAI | Passed offline |
| OpenAI | Yandex | Passed offline |
| Yandex | Yandex | Passed offline |
| OpenAI | OpenAI | Passed offline |

Luna and Sol profiles work independently of role: Luna keeps reasoning=none and
temperature=0; Sol keeps reasoning=medium and omits temperature. Both use Responses
with store=false and reasoning history. Yandex uses Chat Completions without
OpenAI reasoning parameters. All entries remain subject to live conformance.

## Verification

- AI-only results within the final run: 8 suites, 173 tests passed.
- Expanded targeted run: 23 suites, 244 passed / 6 failed (250 tests).
- The same six failures reproduced independently in the restored Phase 4 snapshot:
  five in `product-multi-action-cross-domain.spec.ts`, one in
  `product-agent-presentation.spec.ts`, all `ProductWorkspacePlanner` failures.
  Those suites use fixture models. Their three other cases pass in both versions.
  These baseline failures were not hidden, skipped, weakened or fixed out of scope.
- Native loopback HTTP: 10 cases plus parent test, 11 passed. Covers both APIs,
  stalled headers and 200/503 bodies, explicit abort/socket close, quota errors,
  request IDs and one physical send. No paid provider calls.
- TypeScript build configuration: passed with `--noEmit --incremental false`.
- Separate compile-time assignment check: existing ChatOpenAI and non-OpenAI
  FakeListChatModel both fit the new return type; no application changes needed.
- No dependencies were installed or updated; shared node_modules was not edited.

`git diff --check` passed. Protected application/domain paths and dependency
manifests have no changes; the embedding-method source suffix matches the backup.
The Git index remains empty and published HEAD is unchanged.

Local evidence: `.tmp/direct-final-ai.json`, `.tmp/direct-final-regression.json`,
`.tmp/direct-baseline-failures.json`, `.tmp/direct-native-http.log`.
An initial run of new mock tests exposed incorrect test assumptions:
SDK 6.46.0 uses requestID (not request_id); Node DOMException crosses Jest's realm.
Fixtures now use the SDK's actual property and a local AbortError. Native HTTP
tests independently confirm real timeout classification; no production workaround
or relaxed error assertions was added.

## Recovery of Phase 4

Before any edits, verified the exact branch, HEAD and 26 changed/untracked files.
Backup directory:
`E:/Codex/2026-09-11/ecommerce-backend/phase4-backup-20261015-121826`.
It contains `files/`, `manifest.json` and `RECOVERY.txt`: 44 source/test/report
files in src/ai and infra/litellm, plus 68 Phase 4 diagnostics from .tmp. Every
copied file was SHA-256 verified. Ignored .env files were not copied or modified.

A recovery rehearsal extracted the published base source with git archive, then
overlaid all 112 backed-up files into `.tmp/phase4-recovery-check`. All restored
hashes matched. The baseline suites above were executed against this restored
source, with the same installed dependencies. Recovery does not require a stash,
commit, destructive reset, history rewrite or loss of the simplified code.

For future recovery, restore into a separate directory based on the recorded
HEAD, overlay `files/` preserving paths, then verify every hash in manifest.json.
Keep secrets separately; copy no env file over existing credentials. The backup
is local, not stored remotely, and must be retained until the user accepts removal.

## Remaining readiness limits

No live model/account, production latency, provider billing or load certification.
Configure real role models/credentials and explicitly migrate CHAT_MODE=gateway
before deployment. The six baseline Product tests remain unresolved.
Workspace repair, Handoff retries, nested LangGraph timeout signal loss and
Socket.IO ownership semantics are unchanged, as required. No whole-operation
deadline, budget hard cap, tool rollback or exactly-once guarantee is claimed.
Provider switching does not certify migration of an active provider-specific
conversation history. See README for the live conformance checklist.

The archived LiteLLM reports remain historical evidence; their runtime commands
and budget admission guarantees no longer describe the target application.

## Exact inventory and measured complexity

The following inventory compares the pre-edit Phase 4 snapshot with the final
working files, not just with the older published Phase 3 commit.

<!-- generated inventory -->

| Measurement | Phase 4 snapshot | Direct result |
| --- | ---: | ---: |
| Files in src/ai + infra/litellm, excluding ignored files | 44 | 25 |
| Provider runtime source files (TS + Python) | 8 | 4 |
| Lines in those runtime files (including comments/blanks) | 1631 | 1013 |
| chat-http.ts lines | 217 | 95 |

The runtime measurement includes the unchanged embedding methods in AiService
and existing usage extraction, excludes tests/docs/config and is not a cyclomatic
complexity score. No new production source file or dependency was added. The old
tier:lite/primary tag inferred from role was removed: roles no longer imply a
model tier. Role/provider/model tags and callbacks remain.

### Removed (23)

- `infra/litellm/.env.example`
- `infra/litellm/budget_admission.py`
- `infra/litellm/compose.budgets.yaml`
- `infra/litellm/compose.test.budgets.yaml`
- `infra/litellm/compose.test.reliability.yaml`
- `infra/litellm/compose.test.yaml`
- `infra/litellm/compose.yaml`
- `infra/litellm/config.openai.yaml`
- `infra/litellm/config.yandex.yaml`
- `infra/litellm/gateway_policy.py`
- `infra/litellm/tests/budget_admission.integration.cjs`
- `infra/litellm/tests/runtime.py`
- `infra/litellm/tests/test_budget_admission.py`
- `infra/litellm/tests/test_policy.py`
- `infra/litellm/tests/test_upstream_http.py`
- `infra/litellm/upstream_http.py`
- `src/ai/chat-execution.spec.ts`
- `src/ai/chat-execution.ts`
- `src/ai/gateway-budget-reliability.integration.spec.ts`
- `src/ai/gateway-config.spec.ts`
- `src/ai/gateway-reliability.integration.spec.ts`
- `src/ai/gateway.integration.spec.ts`
- `src/ai/testing/gateway-fixture.ts`

### Modified (10)

- `infra/litellm/README.md`
- `infra/litellm/RELIABILITY.md`
- `src/ai/ai.service.spec.ts`
- `src/ai/ai.service.ts`
- `src/ai/chat-http.spec.ts`
- `src/ai/chat-http.ts`
- `src/ai/chat-transport.contract.spec.ts`
- `src/ai/chat-transport.ts`
- `src/ai/llm-usage.ts`
- `src/ai/README.md`

### Retained (11)

- `src/ai/ai.controller.ts`
- `src/ai/ai.module.ts`
- `src/ai/caller-reliability-boundary.spec.ts`
- `src/ai/chat-transport.spec.ts`
- `src/ai/dto/create-product-embedding-text.dto.ts`
- `src/ai/dto/product-qdrant-point.dto.ts`
- `src/ai/dto/product-semantic-input.dto.ts`
- `src/ai/llm-usage.spec.ts`
- `src/ai/prompts/product-semantic-representation.prompt.ts`
- `src/ai/schemas/product-qdrant-payload.schema.ts`
- `src/ai/schemas/semantic-product-representation.schema.ts`

### Added (4)

- `src/ai/SIMPLIFICATION.md`
- `src/ai/chat-provider-config.spec.ts`
- `src/ai/chat-reliability.spec.ts`
- `src/ai/testing/direct-http.integration.cjs`

Deleted gateway tests remain recoverable in the snapshot. General completion,
finish-reason, error, abort, timeout, no-retry and tool-safety cases are retained
or migrated into direct tests. Budget/fallback/SQL/deadline-manager tests were
retired together with the removed features, not weakened to hide a failure.
