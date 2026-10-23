> Updated package: final pre-commit cleanup on 2026-10-23 is reconstructed and checked under `.tmp/precommit-review`. The original `.tmp/production-review` package and audit logs are retained unchanged. B tests now avoid the Direct constructor; E adds bounded snapshot caching, disabled-mode query parity and guarded opt-in prune.

# Source review and rollback — 2026-10-22

Uncommitted branch: refactor/ai-provider-abstraction. HEAD: aff28c0ee5912047f524b16db9fd8a262606ecf2. No Git history, index, commit or remote was changed. Patches live under [.tmp/production-review](../.tmp/production-review/manifest.json). They are review artifacts, not scheduled commits.

Apply A, B, C, D, E, F in that order to an exported checkout at this HEAD. The builder uses git archive and git apply inside a disposable directory; the original working tree is preserved. Full reconstruction is compared against every changed/untracked source path (UTF-8/LF normalized). Patch SHA-256 hashes are in the manifest.

A is the shared Direct foundation. B semantic validation and C Workspace fixes remain separate. D adds providers, E adds embeddings/index lifecycle, F adds single-call fallback. Shared AiService edits are represented as sequential hunks rather than duplicated whole files.

## Independent rollback

B, C, D, E and F each have a tested rollback-<letter>.patch from the final tree. Each was actually applied, its target contents compared, TypeScript-checked, and reversed again on the disposable copy. These are alternatives from the exact final tree, not a sequence to apply blindly; perform a fresh diff/review after any other edit. B/C rollbacks intentionally restore their previous behavior; compilation passing does not mean their fixed regressions should remain green.

D rollback removes Qwen/Giga-specific support/conformance and retains the common per-role configuration required by F; configure remaining roles/fallbacks to OpenAI or Yandex before deployment. The Yandex/OpenAI-to-Qwen HTTP test requires D+F and is removed with D rollback. This is why the dedicated rollback variant is used instead of assuming git revert D is conflict-free.

E rollback restores prior single-index code, preserving chat fallback/provider support. It cannot reverse a future data migration: use the separately documented PG/Qdrant snapshot plan first. F rollback retains D/E and removes the wrapper/routing. A is a dependency for the later infrastructure sets; full rollback of A means restoring the retained Phase 3 source/archive plus coordinated configuration, not removing its transport guards underneath dependent code.

No rollback is applied to the real checkout. No real database/vector rollback, branch switch, reset or destructive cleanup has been run.

## Verified backups

- ../direct-backup-20261017-061945: 25 files; all SHA-256 match.
- ../phase4-backup-20261015-121826: 112 files; all SHA-256 match.
- ../direct-review-backup-20261022: 26 files; all SHA-256 match.
- .tmp/production-failover-before: 41 files and deleted-path manifest; all SHA-256 match.

## Patch file inventory

### A: A-direct.patch

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

### B: B-semantic.patch

- `src/ai/ai.service.ts`
- `src/ai/product-semantic-validation.spec.ts`

### C: C-workspace.patch

- `src/product-consultation/application/context/tests/product-consultation-context-usage.spec.ts`
- `src/product-consultation/application/workspace/product-multi-action.spec.ts`
- `src/product-consultation/application/workspace/product-workspace-model-plan-tolerance.spec.ts`
- `src/product-consultation/application/workspace/product-workspace-plan.ts`
- `src/product-consultation/application/workspace/product-workspace.spec.ts`
- `src/product-consultation/application/workspace/product-workspace.test-fixtures.ts`
- `infra/DIRECT-PRODUCTION-FIXES.md`

### D: D-providers.patch

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
- `infra/provider-conformance/GIGACHAT-NATIVE.md`
- `src/ai/gigachat-config.spec.ts`
- `src/ai/gigachat-model.ts`
- `src/ai/testing/gigachat-http.integration.cjs`

### E: E-embeddings.patch

- `src/ai/ai.service.spec.ts`
- `src/ai/ai.service.ts`
- `src/core/qdrant/qdrant.module.ts`
- `src/core/qdrant/qdrant.service.ts`
- `src/modules/products/products.service.ts`
- `src/product-consultation/adapters/current-store/current-store-product-search.service.ts`
- `src/store-knowledge/store-knowledge.service.ts`
- `infra/EMBEDDING-FAILOVER.md`
- `src/ai/embedding-execution.ts`
- `src/ai/embedding-index-lifecycle.spec.ts`
- `src/ai/embedding-retrieval.spec.ts`
- `src/ai/embedding-retrieval.ts`
- `src/ai/product-index-version.ts`
- `src/ai/testing/embedding-http.integration.cjs`
- `src/ai/testing/reconcile-embedding-indices.cjs`

### F: F-fallback.patch

- `src/ai/ai.service.ts`
- `infra/CHAT-FAILOVER.md`
- `infra/PRODUCTION-AI-REVIEW.md`
- `src/ai/chat-fallback.spec.ts`
- `src/ai/chat-fallback.ts`
- `src/ai/testing/fallback-http.integration.cjs`
- `infra/PRODUCTION-GIT-REVIEW.md`
