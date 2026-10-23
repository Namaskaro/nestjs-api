> HISTORICAL SNAPSHOT — preserved research/results, not current deployment instructions. Final pre-commit cleanup (2026-10-23) supersedes runtime/status claims below; see [current implementation](PRODUCTION-AI-REVIEW.md).

# Git Review & Rollback Plan — 2026-10-22

No commit/push/merge/rebase/reset was performed. Branch is `refactor/ai-provider-abstraction`; HEAD remains `aff28c0ee5912047f524b16db9fd8a262606ecf2`. This review concerns the local tree. Existing remote history was not rewritten.

## Preserved backups

All are outside this Git checkout, under its parent workspace:

- `direct-backup-20261017-061945`: 25 files, the previous Direct snapshot.
- `phase4-backup-20261015-121826`: 112 files, the earlier Phase 4 archive.
- `direct-review-backup-20261022`: 26 existing changed/untracked files before this task; manifest records SHA256, branch/HEAD and deleted paths.

Manifest hashes were checked. Existing backups and the earlier two-way patches in `.tmp/direct-review` were preserved. The new four-way review is under `.tmp/finish-review`; it does not replace those archives. Backup manifests cover file contents, while the unchanged Git base supplies unchanged tracked files and deletion metadata supplies removals. No secrets or node_modules were added to patches.

## Independent change sets

| Set | Scope | Patch |
| --- | --- | --- |
| A | Accepted Direct infrastructure and preserved historical LiteLLM experiment; **no Workspace changes, no semantic parse** | [A-direct.patch](../.tmp/finish-review/A-direct.patch) |
| B | Only semantic `parse(result)` hunk plus its direct regression spec | [B-semantic.patch](../.tmp/finish-review/B-semantic.patch) |
| C | Agreed Workspace preflight fixes, model-wire fixtures and related regression corrections; historical application-fixes report | [C-workspace.patch](../.tmp/finish-review/C-workspace.patch) |
| D | Qwen on existing transport, configuration/tests/smoke; GigaChat acceptance only; current research/review deliverables | [D-providers.patch](../.tmp/finish-review/D-providers.patch) |

The four patches are ordered increments from HEAD. A is the previously verified Direct-only patch, retained byte-for-byte. D shares `ai.service.ts` with B but its hunks do not include semantic validation. D has no dependency on the semantic parse. C contains no provider/embedding integration. D's embedding-related files are read-only diagnostics and documentation, not runtime changes.

Reconstruction verification applies A → B → C → D to an exported HEAD under `.tmp`, then compares every changed/untracked file with the working tree after normalizing CRLF/LF. It also reverses B on that reconstructed tree and verifies that only `ai.service.ts` and its semantic spec change, then reapplies B. No current workspace file or Git index is altered by this check. File lists and patch hashes are in [manifest.json](../.tmp/finish-review/manifest.json).

## Future publication, only after review

Suggested separate commits: A Direct simplification; B semantic validation; C Workspace corrections; D Qwen integration and conformance/research artifacts. B and D can be reviewed/published independently of C after A. The remaining MI-03 failure must be explicitly resolved or recorded as a separate release exception; the full suite is not green.

After real commits exist, an independent `git revert <B-SHA>` must remove only the semantic validation hunk and its test. No SHA is invented here. C and D are separate commits so their rollback does not remove that guard. Reverting D first restores the two chat-provider selector/profile/config tests without touching embeddings or Workspace. Reverting A is a separate deployment decision, since its parent contains LiteLLM runtime: do not blindly revert it in a production environment configured for Direct.

Before merge: verify branch/base and clean diff scope; use a fresh locked dependency installation; rerun AI/native HTTP/tsc and full Jest; inspect B in isolation; check configuration for both roles; obtain permission for live provider conformance. Resolve active-conversation reasoning compatibility rather than claiming transparent cross-provider continuation. Embedding migration, BM25 fallback, deferred indexing and GigaChat runtime need separate approved changes.

## Files per change set

<!-- Generated file lists follow. -->

### A (33 paths)

- `infra/litellm/.env.example`
- `infra/litellm/README.md`
- `infra/litellm/compose.budgets.yaml`
- `infra/litellm/compose.test.budgets.yaml`
- `infra/litellm/compose.test.yaml`
- `infra/litellm/compose.yaml`
- `infra/litellm/config.openai.yaml`
- `infra/litellm/config.yandex.yaml`
- `infra/litellm/gateway_policy.py`
- `infra/litellm/tests/runtime.py`
- `infra/litellm/tests/test_policy.py`
- `src/ai/README.md`
- `src/ai/ai.service.spec.ts`
- `src/ai/ai.service.ts`
- `src/ai/chat-http.spec.ts`
- `src/ai/chat-http.ts`
- `src/ai/chat-transport.contract.spec.ts`
- `src/ai/chat-transport.ts`
- `src/ai/gateway-config.spec.ts`
- `src/ai/gateway.integration.spec.ts`
- `src/ai/llm-usage.ts`
- `infra/FINAL-DIRECT-REVIEW.md`
- `infra/litellm/MINIMAL-GATEWAY.md`
- `infra/litellm/RELIABILITY.md`
- `infra/litellm/compose.conformance.yaml`
- `infra/litellm/tests/stock.config.yaml`
- `infra/litellm/tests/stock.integration.cjs`
- `infra/litellm/tests/stock_runtime.py`
- `src/ai/SIMPLIFICATION.md`
- `src/ai/caller-reliability-boundary.spec.ts`
- `src/ai/chat-provider-config.spec.ts`
- `src/ai/chat-reliability.spec.ts`
- `src/ai/testing/direct-http.integration.cjs`

### B (2 paths)

- `src/ai/ai.service.ts`
- `src/ai/product-semantic-validation.spec.ts`

### C (7 paths)

- `src/product-consultation/application/context/tests/product-consultation-context-usage.spec.ts`
- `src/product-consultation/application/workspace/product-multi-action.spec.ts`
- `src/product-consultation/application/workspace/product-workspace-model-plan-tolerance.spec.ts`
- `src/product-consultation/application/workspace/product-workspace-plan.ts`
- `src/product-consultation/application/workspace/product-workspace.spec.ts`
- `src/product-consultation/application/workspace/product-workspace.test-fixtures.ts`
- `infra/DIRECT-PRODUCTION-FIXES.md`

### D (18 paths)

- `src/ai/README.md`
- `src/ai/ai.service.spec.ts`
- `src/ai/ai.service.ts`
- `src/ai/chat-transport.ts`
- `infra/AI-PROVIDERS-STATUS.md`
- `infra/AI-TEST-RESULTS.md`
- `infra/EMBEDDINGS-RELIABILITY-RESEARCH.md`
- `infra/GIT-REVIEW-ROLLBACK.md`
- `infra/provider-conformance/README.md`
- `infra/provider-conformance/gigachat-package-lock.json`
- `infra/provider-conformance/gigachat-package.json`
- `infra/provider-conformance/gigachat.acceptance.cjs`
- `infra/provider-conformance/qdrant-readonly.cjs`
- `src/ai/.env.example`
- `src/ai/chat-provider-config.spec.ts`
- `src/ai/qwen.contract.spec.ts`
- `src/ai/testing/direct-http.integration.cjs`
- `src/ai/testing/provider-smoke.cjs`
