# Isolated provider/retrieval research

These scripts are not imported by NestJS, ordinary Jest or required CI. No live LLM calls are needed.

## GigaChat strict acceptance

Use the project dependencies first. Install the official experimental adapter in an isolated directory (never into the shared project node_modules junction):

```powershell
New-Item -ItemType Directory -Force .tmp/gigachat-compat | Out-Null
Copy-Item infra/provider-conformance/gigachat-package.json .tmp/gigachat-compat/package.json
Copy-Item infra/provider-conformance/gigachat-package-lock.json .tmp/gigachat-compat/package-lock.json
npm ci --prefix .tmp/gigachat-compat --ignore-scripts --legacy-peer-deps --no-audit --no-fund
node --test infra/provider-conformance/gigachat.acceptance.cjs
```

The lock captures the tested official adapter 0.0.18 and SDK 0.0.20. `@langchain/core`, LangGraph and application Zod resolve from the project. The test's loopback server covers both JSON and SSE. Fixed fake accessToken prevents OAuth calls. Expected result: 2 passing/7 failing subtests; see [status report](../AI-PROVIDERS-STATUS.md). Do not turn unsupported contracts into passing expectations.

## Qdrant read-only inspection

`node infra/provider-conformance/qdrant-readonly.cjs` inspects only the local `127.0.0.1:6333` endpoint, caps scanning at 10,000 points and bounds each HTTP request to five seconds. It performs metadata/scroll/query operations only, never embeddings/upsert/delete. It saves aggregate counts under `.tmp/provider-research`; no payloads or point IDs are printed. Confirm this is the intended local instance before running on a different machine. The 2026-10-22 observations are in [the research report](../EMBEDDINGS-RELIABILITY-RESEARCH.md).
