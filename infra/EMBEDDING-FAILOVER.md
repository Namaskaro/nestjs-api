> **Исторический материал (до 26.10.2026).** Актуальные конфигурация, статусы, индексация и rollback: [AI_PROVIDERS.md](../docs/AI_PROVIDERS.md). Примеры Alibaba/OpenAI secondary и прежний CLI/prune ниже сохранены для истории и не являются текущей инструкцией запуска.

# Embedding failover — pre-commit review (2026-10-23)

Routing default is unchanged (bounded embedding requests and zero SDK retries apply in both modes): `EMBEDDING_FAILOVER_ENABLED=false` (or absent). No real indexing, collection writes, migrations or paid calls were performed during this work.

## Configuration

```dotenv
EMBEDDING_PROVIDER=yandex
EMBEDDING_FAILOVER_ENABLED=true
EMBEDDING_REQUEST_TIMEOUT_MS=60000
QDRANT_REQUEST_TIMEOUT_MS=60000
YANDEX_EMBEDDING_AUTH_TYPE=api-key
YANDEX_FOLDER_ID=<folder>
YANDEX_API_KEY=<secret from environment>
YANDEX_EMBEDDING_QUERY_MODEL=emb://<folder>/text-embeddings-v2-query/
YANDEX_EMBEDDING_DOCUMENT_MODEL=emb://<folder>/text-embeddings-v2-doc/
YANDEX_EMBEDDING_DIMENSIONS=768
OPENAI_API_KEY=<secret from environment>
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
QDRANT_PRODUCTS_SECONDARY_COLLECTION=products_openai_v1
QDRANT_KNOWLEDGE_SECONDARY_COLLECTION=knowledge_openai_v1
```

Examples require live confirmation in the target account. The primary PG `ProductEmbedding` column remains vector(768). OpenAI vectors are NEVER stored in that column. Old Yandex v1 search models are 256-dimensional; do not pair them with the existing 768-dimensional collections. Yandex v2 supports 768; OpenAI text-embedding-3-small normally uses 1536. [Yandex model table](https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/embeddings), [OpenAI embeddings](https://platform.openai.com/docs/guides/embeddings).

`YANDEX_EMBEDDING_AUTH_TYPE` defaults to `iam` to retain the old Bearer behavior; select `api-key` explicitly for an API key. Chat configuration remains independent. Secrets are not recorded in logs.

## Retrieval and errors

With failover off, search performs no source-catalog load or index completeness check. Products retain the original narrow final PG projection, and knowledge adds no PG reads. The existing query embedding and hybrid search route is preserved.

With failover on, eligible source versions and exact index completeness checks use a five-second per-process snapshot in the existing retrieval helper. Concurrent callers share the same pending read/check; PG/Qdrant failures are not cached. Each logical collection has its own snapshot, and each embedding space its own check. Product versions hash indexed fields (including related labels and eligibility); knowledge uses updatedAt. Full scans therefore run once per snapshot, not once per user request. Request filters still include the authoritative snapshot IDs/versions; this remains intended for the current small catalog.

Local index writes invalidate snapshots at entry and exit, and product deletion invalidates them too. Candidate PG eligibility/version checks still run on every retrieval and reject changed records before presentation. There is no cross-process invalidation: writes through another replica, failed semantic extraction before indexing, and external metadata changes can remain absent from the snapshot for up to five seconds, plus any already-running PG/Qdrant check. This is a bounded cache, not a claim of instant global completeness or distributed atomicity. No new service, readiness scheduler or retry manager was added.

The order remains Yandex+primary, OpenAI+secondary, then BM25 on primary. A healthy primary never reads the secondary configuration/collection. A missing secondary (HTTP 404) or incomplete secondary is skipped on degradation; its absence is cached as incomplete until snapshot expiry, so recovery is discovered on the next refresh. Incompatible configuration/auth and general Qdrant errors still propagate and invalidate the snapshot. Incomplete primary sparse coverage raises `EmbeddingIndexIncompleteError`. A legitimately empty snapshot or completed empty search does not trigger another paid request.

Both hybrid branches and BM25 use the same existing hard filter, plus authoritative IDs/versions. Product payload validation, final PG eligibility/filter checks and reranker are preserved. Knowledge search also excludes deactivated/deleted/stale rows before reranking. Qdrant/PG/configuration/programming errors propagate; a retrieval failure is not represented as an empty catalog. Existing consultation error handling remains `search_failed`.

Allowed degradation: HTTP 408/500/502/503/504, known rate-limit 429 codes, bounded provider timeout, allowlisted connection errors. Unknown 429 and quota/billing errors, 401/403, wrong dimensions, TLS/configuration failures and caller abort do not trigger provider fallback. SDK retries are disabled. Each request, including reading its body, is bounded. An explicit caller signal is checked before sends and between attempts. No sticky circuit breaker: a new query tries primary again.

There is no new whole-operation timeout. Two embedding attempts may consume up to two configured per-request limits; PG, Qdrant calls and reranking add their own time. `ProductSearchPort` currently has no AbortSignal argument: cancellation tests prove the embedding/helper APIs, not end-to-end graph cancellation. PG/reranker waits are outside this patch's timeout scope. No Phase 5 changes were made.

## Writes and recovery

Product create/update already commits its PostgreSQL row before indexing. The existing entry point writes current sparse-only points to available configured collections first, then obtains each provider's document embedding and upserts its dense+sparse point. An absent optional secondary (404) logs `secondary_missing` and does not block updating the primary; it requires explicit reconciliation later. Other Qdrant/config errors propagate. An upsert replaces the full point, removing an obsolete dense vector. [Qdrant points](https://qdrant.tech/documentation/manage-data/points/?q=batch).

Only primary dense vectors update `ProductEmbedding`. Primary unavailability removes its obsolete PG vector. Secondary availability failure leaves sparse data plus an `index_pending` log; there is no whole-product retry. If both embedding APIs are down, successfully extracted product text remains searchable by BM25. If semantic extraction LLMs are also down, indexing cannot create that text: the PG product remains the source for later manual reconciliation, and search reports incomplete index rather than silently hiding it.

Delete removes the PG product once, then attempts both index deletes. An index outage logs `index_delete_pending`; PG IDs/eligibility prevent orphan hits, and separately confirmed reconciliation cleanup can prune them. Knowledge import uses the same dual-index writer. Failed secondary writes and missed source updates are detected on the next completeness check. No queue or background service was added.

Source fingerprints are not a distributed transaction. Ordinary stock decrements with unchanged eligibility do not invalidate product vectors; becoming unavailable/available does. Concurrent indexing can finish out of order; mismatched versions are excluded and manual reconciliation repairs them. Related brand/category changes are detected by the product fingerprint and require reconciliation if their write path did not index the products. Changes to provider weights behind a mutable model alias also require a controlled reindex: the fingerprint identifies configured models/dimensions, not the provider's actual returned modelVersion. These are explicit limitations, not a claim of exactly-once or continuously consistent indexing.

## Controlled migration for Qdrant 1.17.0 — NOT EXECUTED

1. Review target URLs/models/dimensions/auth and approve paid calls + PG/Qdrant mutations. Pause catalog/knowledge writes and retrieval traffic for maintenance; no cross-store atomic cutover is claimed.
2. Back up PostgreSQL (including ProductEmbedding) and snapshot existing `products` and `store_knowledge`; record their 768/Cosine + bm25/idf configurations. Existing vectors have no reliable model provenance and must not simply be relabeled.
3. Keep the serving application's failover flag off. Set the above variables only for the maintenance command. Approve new, distinct secondary collection names. No in-place vector-size change, alias switch, schema migration or collection deletion is needed.
4. Explicit apply command (only after approval): `ALLOW_EMBEDDING_REINDEX=1 node src/ai/testing/reconcile-embedding-indices.cjs --apply` (PowerShell: set `$env:ALLOW_EMBEDDING_REINDEX='1'` first). It validates primary collections, creates missing secondaries, rebuilds both spaces from PG, and verifies dense/sparse coverage. Orphan pruning is OFF by default, including with --apply. Product semantic extraction is reused; worst-case calls for P products and K knowledge rows: P semantic calls (up to 2P with configured chat fallback) and 2(P+K) embedding calls. This is a count, not a price estimate.
5. Run `node src/ai/testing/reconcile-embedding-indices.cjs --verify`: PG/Qdrant reads only, no LLM calls or writes. Nonzero exit means incomplete. Check filtered search quality and final PG authority before enabling serving failover and resuming traffic.
6. After any partial failure, keep maintenance mode and repeat explicit reconciliation from PG. During an embedding outage the writer can retain BM25, but full verification intentionally stays nonzero until both dense spaces are complete. New products blocked earlier by semantic extraction are rebuilt by this same command after LLM recovery.

The script without arguments prints help and exits before loading database clients. No scheduler, API endpoint or startup reindex was added. It is deliberately sequential for a small catalog. Do not run concurrent reconciliation or mutate the catalog while it runs.

Optional orphan cleanup requires separate exact `EMBEDDING_PRUNE_COLLECTION` confirmation (one of the four configured collections) and `EMBEDDING_PRUNE_MAX_POINTS=1..1000`, in addition to --apply authorization. Empty source IDs or zero overlap with the target collection are always refused. The command selects at most limit+1 orphan IDs and refuses excess/unfinished selection; delete uses only the inspected bounded IDs, never an expanding delete-by-filter. Wrong/empty PG source cannot automatically wipe a collection. Clearing a legitimately empty catalog is deliberately outside this command. Verify actual PG/Qdrant endpoints and approved snapshots before setting the confirmation variables.

Timeout/retry changes apply even when routing is off: embedding HTTP waits (including bodies) are bounded to EMBEDDING_REQUEST_TIMEOUT_MS, default 60000 ms; OpenAI embedding SDK automatic retries are now zero (previous SDK defaults allowed retries), and Yandex batches are sequential. Qdrant timeout is explicitly 60000 ms instead of the previous client default 300000 ms. PG/reranker timing is unchanged. These are failure/latency changes, not changes to successful search/filtering rules.

## Rollback

Disable failover routing only after ensuring a complete primary dense index exists. To return to the pre-migration state, keep maintenance mode, restore the recorded PG/Qdrant snapshots consistently, remove E code/config, and verify the original primary search. Leave secondary collections untouched until separately approved cleanup; no destructive cleanup command runs automatically. Reverting source or a flag alone cannot restore vectors replaced during a future migration.

Files: `src/ai/embedding-execution.ts`, `embedding-retrieval.ts`, embedding methods in `ai.service.ts`, `src/core/qdrant/qdrant.service.ts`, `qdrant.module.ts`, the existing product search adapter, `ProductsService`, `StoreKnowledgeService`, and `src/ai/testing/reconcile-embedding-indices.cjs`. No Prisma/Qdrant domain schema, Orders, Commerce or frontend changes.
