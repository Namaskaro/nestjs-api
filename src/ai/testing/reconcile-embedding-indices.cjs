// Explicit maintenance only. Importing this file never opens clients or writes data.
const inputError = message => Object.assign(Error(message), { name: 'ReconciliationInputError' });
function options(args, env = process.env) {
  const modes = args.filter(a => ['--dry-run', '--apply', '--verify'].includes(a));
  if (modes.length !== 1 || args.some(a => !['--dry-run', '--apply', '--verify', '--secondary-only'].includes(a)) || new Set(args).size !== args.length)
    throw inputError('Usage: --dry-run | --apply | --verify [--secondary-only]');
  if (env.EMBEDDING_PRUNE_COLLECTION !== undefined || env.EMBEDDING_PRUNE_MAX_POINTS !== undefined)
    throw inputError('Pruning is not supported by reconciliation. Remove prune settings; deletion requires a separate reviewed operation.');
  if (modes[0] === '--apply' && env.ALLOW_EMBEDDING_REINDEX !== '1')
    throw inputError('Explicit ALLOW_EMBEDDING_REINDEX=1 required after operator approval of paid embeddings and Qdrant writes');
  return { mode: modes[0].slice(2), scope: args.includes('--secondary-only') ? 'secondary' : 'all' };
}

async function reconcile(option, { ai, prisma, qdrant, products, knowledge, log = console.log }) {
  const { embeddingSpace } = require('../embedding-execution.ts');
  const { productIndexVersion, PRODUCT_INDEX_SOURCE_INCLUDE } = require('../product-index-version.ts');
  const sources = async () => [
    ['products', (await prisma.product.findMany({ include: PRODUCT_INDEX_SOURCE_INCLUDE })).map(p => ({ id: p.id, version: productIndexVersion(p) }))],
    ['store_knowledge', (await prisma.storeKnowledge.findMany({ select: { id: true, updatedAt: true } })).map(k => ({ id: k.id, version: k.updatedAt.toISOString() }))],
  ].map(([collection, versions]) => [collection, versions.sort((a, b) => a.id.localeCompare(b.id))]);
  if (ai.getEmbeddingSpec('yandex').dimensions !== 768) throw Error('Primary ProductEmbedding must stay 768-dimensional');
  const before = await sources();
  const targets = before.flatMap(([collection, versions]) => ['yandex', ai.embeddingFallbackProvider].map(provider => ({
    collection: provider === 'yandex' ? collection : ai.secondaryEmbeddingCollection(collection),
    provider, versions, spec: ai.getEmbeddingSpec(provider),
  })));
  // Check every existing configuration before collection creation or paid calls.
  for (const target of targets) {
    try { await qdrant.validateEmbeddingCollection(target.collection, target.spec.dimensions); }
    catch (error) {
      if (target.provider === 'yandex' || error?.status !== 404) throw error;
      target.missing = true;
    }
  }
  const count = before.reduce((n, [, versions]) => n + versions.length, 0);
  const plan = { mode: option.mode, scope: option.scope, records: Object.fromEntries(before.map(([c, v]) => [c, v.length])),
    embeddingRequests: { yandex: option.scope === 'all' ? count : 0, [ai.embeddingFallbackProvider]: count },
    llmRequests: 0, postgresWrites: option.scope === 'all' ? before[0][1].length : 0,
    collectionsToCreate: targets.filter(t => t.missing).map(t => t.collection),
    cost: 'sum(actual input tokens per provider * current account price per million / 1000000); no tariff or tokenizer assumed',
  };
  if (option.mode !== 'verify') {
    log(JSON.stringify({ plan }));
    // Both real service paths prepare exactly their normal text/payload, without
    // generating semantic descriptions or writing anything during preflight.
    const productPlan = await products.reindexProducts({ scope: option.scope, dryRun: true });
    const knowledgePlan = await knowledge.reindexSearchIndices({ scope: option.scope, dryRun: true });
    plan.textChars = productPlan.textChars + knowledgePlan.textChars;
    log(JSON.stringify({ prepared: { ...plan, note: 'Request counts assume one embedding call per row/provider, no retries. Characters are not billable tokens.' } }));
    if (option.mode === 'dry-run') return { plan };
    // Refuse a source change between preparation and the first write. Operators
    // must still pause catalog/knowledge writes throughout the maintenance window.
    if (JSON.stringify(await sources()) !== JSON.stringify(before)) throw Error('Sources changed during preflight; pause writes and rerun dry-run');
    for (const target of targets.filter(t => t.provider !== 'yandex'))
      await qdrant.createEmbeddingCollection(target.collection, target.spec.dimensions);
    await products.reindexProducts({ scope: option.scope });
    await knowledge.reindexSearchIndices({ scope: option.scope });
  }
  const current = await sources();
  const verification = [];
  for (const target of targets) {
    const logical = target.provider === 'yandex' ? target.collection : before.find(([c]) => ai.secondaryEmbeddingCollection(c) === target.collection)[0];
    const versions = current.find(([c]) => c === logical)[1];
    const missing = option.mode === 'verify' && target.missing;
    verification.push({ collection: target.collection, provider: target.provider, model: target.spec.documentModel,
      dimensions: target.spec.dimensions, space: embeddingSpace(target.spec), expected: versions.length,
      denseComplete: !missing && await qdrant.embeddingIndexComplete(target.collection, versions, embeddingSpace(target.spec)),
      sparseComplete: !missing && await qdrant.embeddingIndexComplete(target.collection, versions),
    });
  }
  const sourcesStable = JSON.stringify(current) === JSON.stringify(before);
  const readyToEnable = sourcesStable && verification.every(v => v.denseComplete && v.sparseComplete);
  const complete = sourcesStable && verification.filter(v => option.scope === 'all' || v.provider !== 'yandex').every(v => v.denseComplete && v.sparseComplete);
  const result = { verification, sourcesStable, complete, readyToEnable };
  log(JSON.stringify(result));
  return result;
}

async function main() {
  const option = options(process.argv.slice(2));
  require('ts-node/register/transpile-only');
  require('tsconfig-paths/register');
  require('reflect-metadata');
  const { ConfigService } = require('@nestjs/config');
  const { AiService } = require('../ai.service.ts');
  const { PrismaService } = require('../../core/prisma/prisma.service.ts');
  const { QdrantService } = require('../../core/qdrant/qdrant.service.ts');
  const { ProductsService } = require('../../modules/products/products.service.ts');
  const { StoreKnowledgeService } = require('../../store-knowledge/store-knowledge.service.ts');
  const { QdrantClient } = require('@qdrant/js-client-rest');
  const config = new ConfigService();
  if (config.get('EMBEDDING_PROVIDER') !== 'yandex') throw Error('Reconciliation requires EMBEDDING_PROVIDER=yandex');
  const ai = new AiService(config);
  if (!process.env.QDRANT_URL) throw Error('QDRANT_URL required');
  const timeout = Number(process.env.QDRANT_REQUEST_TIMEOUT_MS ?? 60000);
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw Error('Invalid QDRANT_REQUEST_TIMEOUT_MS');
  const qdrant = new QdrantService(new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, timeout }));
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const result = await reconcile(option, { ai, prisma, qdrant,
      products: new ProductsService(prisma, null, null, null, config, null, ai, qdrant),
      knowledge: new StoreKnowledgeService(prisma, ai, qdrant, null),
    });
    if (result.complete === false) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
module.exports = { options, reconcile };
if (require.main === module) main().catch(error => {
  // No SDK body, headers or client configuration: failures can contain secrets.
  console.error(JSON.stringify({ error: error?.name ?? 'Error', status: error?.status,
    ...(error?.code === 'SEMANTIC_CACHE_UNAVAILABLE' ? { code: error.code, productId: error.productId } : {}),
    message: error?.name === 'ReconciliationInputError' ? error.message : 'Reconciliation failed; inspect preflight/verification output. No automatic retry. See docs/AI_PROVIDERS.md.' }));
  process.exitCode = 1;
});
