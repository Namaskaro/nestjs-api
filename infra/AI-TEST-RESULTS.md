> HISTORICAL SNAPSHOT — preserved research/results, not current deployment instructions. Final pre-commit cleanup (2026-10-23) supersedes runtime/status claims below; see [current implementation](PRODUCTION-AI-REVIEW.md).

# Test results — 2026-10-22

Source baseline: `aff28c0ee5912047f524b16db9fd8a262606ecf2`, branch `refactor/ai-provider-abstraction`. Results below describe the local review tree, not published GitHub code. Node 24.3.0; installed Core 1.2.8, LangGraph 1.4.9, LangChain OpenAI 1.5.6, OpenAI SDK 6.46.0, Zod 4.4.3. Existing `node_modules` is a junction to another checkout; no project dependency installation was performed. Clean locked installation remains a release check.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Full repository Jest | **94/95 suites; 715/716 tests pass** | `.tmp/finish-full-final.json`, `.log` |
| AI Jest separately | **10 suites, 195 tests pass** | `.tmp/finish-ai-final.json`, `.log` |
| Native direct HTTP | **15 subtests + parent = 16 pass** | `.tmp/finish-direct-http.log` |
| TypeScript build check | **pass**, `tsc --noEmit -p tsconfig.build.json` | `.tmp/finish-tsc.log` |
| GigaChat experimental acceptance | **2/9 subtests pass, 7 fail** | `.tmp/provider-research/gigachat-acceptance.log`; excluded from ordinary CI |
| Local Qdrant read-only audit | Both collections have dense + nonempty BM25; sparse-only queries return hits and obey impossible filter | `.tmp/provider-research/qdrant-readonly.json` |
| Live smoke preparation | Syntax valid; without explicit opt-in exits 2; full 12-call flow passes with fake HTTP only | `src/ai/testing/provider-smoke.cjs`, `.tmp/finish-smoke-offline.log` |
| Diff whitespace | `git diff --check` passes | CRLF conversion warnings are not failures |

Full Jest includes the original nine shared-fixture suites and the additional own-fixture Workspace suite. The original six failures from the preceding review remain fixed: DTO shape, DETAILS multi-position expectation and four precise preflight clarifications. No paid provider, real Orders, indexing or database mutation was used. E2E tests requiring application/external services were not run. TypeScript build compilation excludes test files; ts-jest execution is not an independent strict test-file typecheck.

## 26 baseline failures and current corrections

[product-workspace.spec.ts](../src/product-consultation/application/workspace/product-workspace.spec.ts) now uses the same model-wire converter as [product-workspace.test-fixtures.ts](../src/product-consultation/application/workspace/product-workspace.test-fixtures.ts). It emits `decision.action`, not `decision.proposal.action`, and validates through `ProductWorkspaceModelPlanSchema`. Production normalization was not adapted to the old test DTO.

[Tolerance](../src/product-consultation/application/workspace/product-workspace-model-plan-tolerance.spec.ts) now expects `running` for «бег». [Context usage](../src/product-consultation/application/context/tests/product-consultation-context-usage.spec.ts) includes both `running` and `training`, matching current Core. No category/usage rule changed.

Two cases revealed by the repaired wire fixture expected a returned Workspace although current preflight rejects the plan: unknown category and repeat `SEARCH continue` after the first search. They now explicitly assert the corresponding exception, unchanged input Workspace and the original search-call counts. Rejected plans do not partially execute. This preserves the rejection invariant and tests the real failure contract instead of inventing a clarification for an unsupported category/operation.

**25 of the 26 prior failures are resolved. One remains intentionally visible:**

`MI-03 gender, brand, size and wedding goal stay in their own SearchSpec/Memory` at `product-workspace.spec.ts` (~537). The fixture puts a wedding goal in internal `proposal.memoryObservations`. The actual model DTO has no such field; `normalizeDecision()` explicitly sets `memoryObservations: []` because the Workspace Planner no longer owns Memory. After correcting the DTO, the search-filter assertions pass; the goal assertion fails because no legitimate owner supplied it.

Classification: stale cross-owner test setup/expectation, not a provider transport failure. The test and its goal assertion were not removed or weakened. Restoring Planner ownership would alter architecture. A separate Memory-owner test must establish the goal through the intended consultation path before checking task isolation; alternatively the product team must explicitly restore a memory extraction contract. Neither is substituted silently in this task.

The full suite therefore remains red and should not be advertised as a clean release gate. This does not require keeping A/B/D coupled to C.

## Preserved checks

- [Semantic validation](../src/ai/product-semantic-validation.spec.ts): real Responses SDK returns completed JSON with `summary:42`; Zod rejects before search-text generation, embeddings, PostgreSQL embedding writes and Qdrant. Valid semantic JSON still passes. Product creation itself can precede indexing; this test does not claim transactionality for product creation.
- [Multi-action regression](../src/product-consultation/application/workspace/product-multi-action.spec.ts): actual invalid DETAILS rejects the whole plan, multiple valid positions work; all lanes are preflighted before actions; infrastructure/programming errors propagate; tools are not replayed.
- Qwen config tests replace the formerly-invalid value `qwen` with `unknown` and update the exact allowed-provider error. Invalid explicit settings still throw; embedding provider validation still rejects Qwen.
- OpenAI Responses reasoning history, transport completion checks, tool calling, independent role selection, embeddings selector isolation and previous caller-boundary tests remain in the successful AI suite.

## Reproduction

From the repository directory:

```powershell
node node_modules/jest/bin/jest.js --runInBand
node node_modules/jest/bin/jest.js --runInBand src/ai
node --test src/ai/testing/direct-http.integration.cjs
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.build.json
node --test infra/provider-conformance/gigachat.acceptance.cjs
```

The last command requires the isolated experimental SDK installation described in [provider-conformance/README.md](provider-conformance/README.md), and is expected to fail for the documented mandatory contracts. Do not add it as a required production CI job or convert these failures into passing assertions.
