// Explicit maintenance only. No application bootstrap, scheduler, or startup writes.
const args = process.argv.slice(2);
if (args.length !== 1 || !['--verify', '--apply'].includes(args[0])) {
  console.log('Usage: node src/ai/testing/reconcile-embedding-indices.cjs --verify | --apply\n--verify: PostgreSQL/Qdrant reads only. --apply: PAID LLM/embedding calls + Qdrant/PG writes; requires ALLOW_EMBEDDING_REINDEX=1. Stop catalog writes and take snapshots first.\nPruning is off by default. Optional cleanup additionally requires an exact EMBEDDING_PRUNE_COLLECTION and EMBEDDING_PRUNE_MAX_POINTS=1..1000. Empty source catalogs are never pruned.');
  process.exit(args.length ? 2 : 0);
}
const apply = args[0] === '--apply';
if (apply && process.env.ALLOW_EMBEDDING_REINDEX !== '1') throw Error('Explicit ALLOW_EMBEDDING_REINDEX=1 required; obtain operator approval first');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
require('reflect-metadata');
const { ConfigService } = require('@nestjs/config');
const { AiService } = require('../ai.service.ts');
const { embeddingSpace } = require('../embedding-execution.ts');
const { productIndexVersion, PRODUCT_INDEX_SOURCE_INCLUDE } = require('../product-index-version.ts');
const { PrismaService } = require('../../core/prisma/prisma.service.ts');
const { QdrantService } = require('../../core/qdrant/qdrant.service.ts');
const { ProductsService } = require('../../modules/products/products.service.ts');
const { StoreKnowledgeService } = require('../../store-knowledge/store-knowledge.service.ts');
const { QdrantClient } = require('@qdrant/js-client-rest');
async function main() {
  const config = new ConfigService();
  const ai = new AiService(config);
  if (!ai.embeddingFailover) throw Error('EMBEDDING_FAILOVER_ENABLED=true required');
  if (ai.getEmbeddingSpec('yandex').dimensions !== 768) throw Error('Primary ProductEmbedding must stay 768-dimensional');
  if (!process.env.QDRANT_URL) throw Error('QDRANT_URL required');
  const timeout = Number(process.env.QDRANT_REQUEST_TIMEOUT_MS ?? 60000);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw Error('Invalid QDRANT_REQUEST_TIMEOUT_MS');
  const qdrant = new QdrantService(new QdrantClient({ url: process.env.QDRANT_URL, timeout }));
  const pruneCollection = process.env.EMBEDDING_PRUNE_COLLECTION;
  const pruneMaxDeletes = Number(process.env.EMBEDDING_PRUNE_MAX_POINTS);
  const allowedCollections = ['products', 'store_knowledge', ai.secondaryEmbeddingCollection('products'), ai.secondaryEmbeddingCollection('store_knowledge')];
  if (pruneCollection !== undefined && (!apply || !allowedCollections.includes(pruneCollection) ||
    !Number.isInteger(pruneMaxDeletes) || pruneMaxDeletes < 1 || pruneMaxDeletes > 1000))
    throw Error('Prune requires --apply, an exact configured EMBEDDING_PRUNE_COLLECTION and EMBEDDING_PRUNE_MAX_POINTS=1..1000');
  if (pruneCollection === undefined && process.env.EMBEDDING_PRUNE_MAX_POINTS !== undefined)
    throw Error('EMBEDDING_PRUNE_COLLECTION required with EMBEDDING_PRUNE_MAX_POINTS');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    for (const collection of ['products', 'store_knowledge']) {
      await qdrant.validateEmbeddingCollection(collection, ai.getEmbeddingSpec('yandex').dimensions);
      const target = ai.secondaryEmbeddingCollection(collection);
      const dimensions = ai.getEmbeddingSpec('openai').dimensions;
      if (apply) await qdrant.createEmbeddingCollection(target, dimensions);
      else await qdrant.validateEmbeddingCollection(target, dimensions);
    }
    if (apply) {
      // These methods only use the supplied AI/PG/Qdrant dependencies.
      await new ProductsService(prisma, null, null, null, config, null, ai, qdrant).reindexProducts();
      await new StoreKnowledgeService(prisma, ai, qdrant, null).reindexSearchIndices();
    }
    let complete = true;
    for (const [collection, delegate] of [['products', prisma.product], ['store_knowledge', prisma.storeKnowledge]]) {
      const rows = await delegate.findMany(collection === 'products' ? { include: PRODUCT_INDEX_SOURCE_INCLUDE } : { select: { id: true, updatedAt: true } });
      const versions = rows.map(row => ({ id: row.id, version: collection === 'products' ? productIndexVersion(row) : row.updatedAt.toISOString() }));
      for (const provider of ['yandex', 'openai']) {
        const target = provider === 'yandex' ? collection : ai.secondaryEmbeddingCollection(collection);
        if (apply && target === pruneCollection) await qdrant.pruneIndex(target, rows.map(row => row.id), {
          collection: pruneCollection, maxDeletes: pruneMaxDeletes,
        });
        const dense = await qdrant.embeddingIndexComplete(target, versions, embeddingSpace(ai.getEmbeddingSpec(provider)));
        const sparse = await qdrant.embeddingIndexComplete(target, versions);
        console.log(JSON.stringify({ collection: target, provider, expected: rows.length, denseComplete: dense, sparseComplete: sparse }));
        complete = complete && dense && sparse;
      }
    }
    if (!complete) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Reconciliation failed'); process.exitCode = 1; });
