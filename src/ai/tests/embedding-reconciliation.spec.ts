const { options, reconcile } = require('./testing/reconcile-embedding-indices.cjs');

function fixture() {
  const ai = {
    embeddingFallbackProvider: 'qwen',
    getEmbeddingSpec: provider => ({ provider, queryModel: provider, documentModel: provider, dimensions: provider === 'yandex' ? 768 : 2560 }),
    secondaryEmbeddingCollection: c => `${c}_fallback`,
  };
  const prisma = { product: { findMany: jest.fn().mockResolvedValue([]) }, storeKnowledge: { findMany: jest.fn().mockResolvedValue([{ id: 'k', updatedAt: new Date(0) }]) } };
  const qdrant = { validateEmbeddingCollection: jest.fn(), createEmbeddingCollection: jest.fn(), embeddingIndexComplete: jest.fn().mockResolvedValue(true) };
  const products = { reindexProducts: jest.fn().mockResolvedValue({ planned: 0, textChars: 0 }) };
  const knowledge = { reindexSearchIndices: jest.fn().mockResolvedValue({ planned: 1, textChars: 12 }) };
  return { ai, prisma, qdrant, products, knowledge, log: jest.fn() };
}
describe('explicit reconciliation maintenance modes', () => {
  it('apply needs approval, duplicate/unknown options and all prune settings fail closed', () => {
    for (const args of [[], ['--apply'], ['--verify', '--apply'], ['--verify', '--verify'], ['--verify', '--force']])
      expect(() => options(args, {})).toThrow();
    expect(() => options(['--apply'], { ALLOW_EMBEDDING_REINDEX: '1', EMBEDDING_PRUNE_COLLECTION: 'products' })).toThrow('Pruning');
    expect(options(['--apply', '--secondary-only'], { ALLOW_EMBEDDING_REINDEX: '1' })).toEqual({ mode: 'apply', scope: 'secondary' });
  });
  it('dry-run tolerates absent secondary, shows costs/calls and has no mutations', async () => {
    const f = fixture();
    f.qdrant.validateEmbeddingCollection.mockImplementation(async c => { if (c.endsWith('_fallback')) throw { status: 404 }; });
    const result = await reconcile(options(['--dry-run', '--secondary-only'], {}), f);
    expect(result.plan.embeddingRequests).toEqual({ yandex: 0, qwen: 1 });
    expect(result.plan.llmRequests).toBe(0);
    expect(result.plan.postgresWrites).toBe(0);
    expect(result.plan.collectionsToCreate).toEqual(['products_fallback', 'store_knowledge_fallback']);
    expect(f.products.reindexProducts).toHaveBeenCalledWith({ scope: 'secondary', dryRun: true });
    expect(f.knowledge.reindexSearchIndices).toHaveBeenCalledWith({ scope: 'secondary', dryRun: true });
    expect(f.qdrant.createEmbeddingCollection).not.toHaveBeenCalled();
  });
  it('verify only reads completeness; a missing secondary is not ready', async () => {
    const f = fixture();
    f.qdrant.validateEmbeddingCollection.mockImplementation(async c => { if (c.endsWith('_fallback')) throw { status: 404 }; });
    const result = await reconcile({ mode: 'verify', scope: 'all' }, f);
    expect(result.readyToEnable).toBe(false);
    expect(result.complete).toBe(false);
    expect(f.products.reindexProducts).not.toHaveBeenCalled();
    expect(f.knowledge.reindexSearchIndices).not.toHaveBeenCalled();
    expect(f.qdrant.createEmbeddingCollection).not.toHaveBeenCalled();
  });
  it('apply preflights both services before creating secondary collections; scope remains secondary', async () => {
    const f = fixture();
    const result = await reconcile({ mode: 'apply', scope: 'secondary' }, f);
    expect(result.readyToEnable).toBe(true);
    expect(f.qdrant.createEmbeddingCollection.mock.calls).toEqual([['products_fallback', 2560], ['store_knowledge_fallback', 2560]]);
    expect(f.products.reindexProducts.mock.calls).toEqual([[{ scope: 'secondary', dryRun: true }], [{ scope: 'secondary' }]]);
    expect(f.knowledge.reindexSearchIndices.mock.invocationCallOrder[0]).toBeLessThan(f.qdrant.createEmbeddingCollection.mock.invocationCallOrder[0]);
  });
  it('invalid source semantics or incompatible collection blocks every write', async () => {
    const f = fixture();
    f.products.reindexProducts.mockRejectedValue(new Error('semantic unavailable'));
    await expect(reconcile({ mode: 'apply', scope: 'secondary' }, f)).rejects.toThrow('semantic unavailable');
    expect(f.qdrant.createEmbeddingCollection).not.toHaveBeenCalled();
    expect(f.knowledge.reindexSearchIndices).not.toHaveBeenCalled();
    const g = fixture();
    g.qdrant.validateEmbeddingCollection.mockRejectedValue(new Error('dimensions'));
    await expect(reconcile({ mode: 'apply', scope: 'secondary' }, g)).rejects.toThrow('dimensions');
    expect(g.qdrant.createEmbeddingCollection).not.toHaveBeenCalled();
  });
  it('changed PG source during preflight prevents first mutation', async () => {
    const f = fixture();
    f.prisma.storeKnowledge.findMany.mockResolvedValueOnce([{ id: 'k', updatedAt: new Date(0) }]).mockResolvedValue([{ id: 'k', updatedAt: new Date(1) }]);
    await expect(reconcile({ mode: 'apply', scope: 'secondary' }, f)).rejects.toThrow('Sources changed');
    expect(f.qdrant.createEmbeddingCollection).not.toHaveBeenCalled();
  });
});
