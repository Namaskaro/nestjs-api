import { productIndexVersion } from './product-index-version';
import { randomUUID } from 'node:crypto';
import { ProductsService } from '../modules/products/products.service';
import { StoreKnowledgeService } from '../store-knowledge/store-knowledge.service';
import { CurrentStoreProductSearchService } from '../product-consultation/adapters/current-store/current-store-product-search.service';
import { EmbeddingRequestError } from './embedding-execution';

const id = randomUUID(),
  brandId = randomUUID(),
  categoryId = randomUUID(),
  subcategoryId = randomUUID();
const semantic = {
  summary: 'shoes',
  targetAudience: [],
  styleAssociations: [],
  useCases: [],
  pricePositioning: 'medium',
  searchTags: [],
};
const product = {
  id,
  updatedAt: new Date('2026-10-20T12:00:00Z'),
  title: 'Shoes',
  description: 'Walking',
  brand: { id: brandId, name: 'Brand' },
  brandId,
  subcategoryId,
  subcategory: {
    id: subcategoryId,
    name: 'Shoes',
    categoryId,
    category: { id: categoryId, name: 'Shoes' },
  },
  price: '1000',
  color: null,
  details: [],
  gender: 'MAN',
  type: 'SHOES',
  sizes: ['43'],
  stock: 3,
  inStock: true,
  images: [],
};
function setup() {
  const ai: any = {
    embeddingFailover: true,
    embeddingFallbackProvider: 'openai',
    getEmbeddingSpec: (provider) => ({
      provider,
      queryModel: provider,
      documentModel: provider,
      dimensions: provider === 'yandex' ? 768 : 1536,
    }),
    secondaryEmbeddingCollection: (c) => c + '_openai',
    createProductSemanticRepresentation: jest.fn().mockResolvedValue(semantic),
    buildProductSearchText: () => 'walking shoes',
    createEmbedding: jest.fn().mockResolvedValue([1, 2]),
  };
  const prisma: any = {
    product: {
      findMany: jest.fn().mockResolvedValue([product]),
      findUnique: jest.fn().mockResolvedValue(product),
      update: jest.fn().mockResolvedValue(product),
      delete: jest.fn().mockResolvedValue(product),
    },
    productEmbedding: { deleteMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  const q: any = {
    validateEmbeddingCollection: jest.fn(),
    embeddingIndexComplete: jest.fn().mockResolvedValue(true),
    savePoint: jest.fn(),
    removeIndexPoints: jest.fn(),
    hybridSearch: jest.fn(),
    keywordSearch: jest.fn(),
  };
  const products = new ProductsService(
    prisma,
    null,
    null,
    null,
    null,
    null,
    ai,
    q,
  );
  return { ai, prisma, q, products };
}
describe('embedding index lifecycle through application entry points', () => {
  it('secondary reconciliation reuses current semantics, rebuilds the normal text and never calls Yandex/LLM or writes PG', async () => {
    const { ai, prisma, q, products } = setup();
    await products.reindexProducts();
    const original = q.savePoint.mock.calls[2][1];
    q.retrievePoints = jest.fn().mockResolvedValue([{ id, payload: original.payload }]);
    q.savePoint.mockClear();
    ai.createEmbedding.mockClear();
    ai.createProductSemanticRepresentation.mockClear();
    prisma.$executeRaw.mockClear();
    ai.embeddingFailover = false; // Prepare while runtime fallback is still off.
    ai.embeddingFallbackProvider = 'qwen';
    ai.secondaryEmbeddingCollection = c => `${c}_fallback`;
    const plan = await products.reindexProducts({ scope: 'secondary', dryRun: true });
    expect(plan).toEqual({ indexed: 0, planned: 1, textChars: 'walking shoes'.length });
    expect(q.savePoint).not.toHaveBeenCalled();
    expect(ai.createEmbedding).not.toHaveBeenCalled();
    await products.reindexProducts({ scope: 'secondary' });
    expect(ai.createProductSemanticRepresentation).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(ai.createEmbedding.mock.calls.map(c => c.slice(0, 3))).toEqual([['walking shoes', 'qwen', 'document']]);
    expect(q.savePoint.mock.calls.map(c => c[0])).toEqual(['products_fallback', 'products_fallback']);
    expect(q.savePoint.mock.calls[1][1].payload).toMatchObject({ ...original.payload, _embedding_provider: 'qwen', _embedding_service: 'qwen', _embedding_model: 'qwen', _embedding_query_model: 'qwen', _embedding_dimensions: 1536, _embedding_space: expect.any(String) });
  });
  it('missing, stale or invalid cached semantics stop reconciliation before a model call or write', async () => {
    const { ai, prisma, q, products } = setup();
    await products.reindexProducts();
    const payload = q.savePoint.mock.calls[2][1].payload;
    ai.createProductSemanticRepresentation.mockClear();
    ai.createEmbedding.mockClear();
    q.savePoint.mockClear();
    prisma.$executeRaw.mockClear();
    for (const cached of [undefined, { ...payload, title: 'old title' }, { ...payload, semanticRepresentation: { ...semantic, summary: 42 } }]) {
      q.retrievePoints = jest.fn().mockResolvedValue([{ id, payload: cached }]);
      await expect(products.reindexProducts({ scope: 'secondary', dryRun: true })).rejects.toThrow('current stored semantic input unavailable');
    }
    expect(ai.createEmbedding).not.toHaveBeenCalled();
    expect(ai.createProductSemanticRepresentation).not.toHaveBeenCalled();
    expect(q.savePoint).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('knowledge secondary-only uses the same deterministic content with no primary calls or PG writes', async () => {
    const { ai, prisma, q } = setup();
    ai.embeddingFailover = false;
    ai.embeddingFallbackProvider = 'qwen';
    ai.secondaryEmbeddingCollection = c => `${c}_fallback`;
    const row = { id, updatedAt: new Date('2026-10-26T00:00:00Z'), key: 'delivery', section: 'Shipping', topic: null, question: 'When?', answer: 'Tomorrow', notice: 'Call', footnote: 'Details' };
    prisma.storeKnowledge = { findMany: jest.fn().mockResolvedValue([row]) };
    const knowledge = new StoreKnowledgeService(prisma, ai, q, null);
    await knowledge.reindexSearchIndices({ scope: 'secondary', dryRun: true });
    expect(ai.createEmbedding).not.toHaveBeenCalled();
    expect(q.savePoint).not.toHaveBeenCalled();
    await knowledge.reindexSearchIndices({ scope: 'secondary' });
    const text = 'Вопрос: When?\n\nОтвет: Tomorrow\n\nВажно: Call\n\nПримечание: Details';
    expect(ai.createEmbedding).toHaveBeenCalledWith(text, 'qwen', 'document', { signal: undefined });
    expect(q.savePoint.mock.calls[1][1]).toMatchObject({ id, payload: { content: text, _source_version: row.updatedAt.toISOString() } });
    expect(q.savePoint.mock.calls.map(c => c[0])).toEqual(['store_knowledge_fallback', 'store_knowledge_fallback']);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('disabled failover preserves the original bounded PG projection and does not scan index coverage', async () => {
    const { ai, prisma, q, products } = setup();
    jest.spyOn(products, 'getProductById').mockResolvedValue(product as any);
    await products.update(id, {} as any);
    const payload = q.savePoint.mock.calls[2][1].payload;
    ai.embeddingFailover = false;
    ai.createQueryEmbedding = jest.fn().mockResolvedValue([1, 2]);
    q.hybridSearch.mockResolvedValue([{ id, payload }]);
    q.validateEmbeddingCollection.mockClear();
    prisma.product.findMany.mockClear();
    const search = new CurrentStoreProductSearchService(ai, q, null, prisma, {
      resolveCatalogFilters: async () => ({
        brandId: null,
        categoryId: null,
        subcategoryId: null,
      }),
    } as any);
    const result = await search.searchProducts({
      semanticQuery: 'shoes',
      filters: {
        gender: null,
        type: null,
        brand: null,
        category: null,
        subcategory: null,
        color: null,
        size: null,
        minPrice: null,
        maxPrice: null,
      },
    });
    expect(result.products.map((p) => p.id)).toEqual([id]);
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany.mock.calls[0][0]).toEqual({
      where: { id: { in: [id] }, inStock: true, stock: { gt: 0 } },
      select: {
        id: true,
        title: true,
        price: true,
        images: true,
        gender: true,
        type: true,
        brandId: true,
        subcategoryId: true,
        color: true,
        sizes: true,
        inStock: true,
        stock: true,
        subcategory: { select: { categoryId: true } },
      },
    });
    expect(q.validateEmbeddingCollection).not.toHaveBeenCalled();
    expect(q.embeddingIndexComplete).not.toHaveBeenCalled();
    expect(ai.createQueryEmbedding).toHaveBeenCalledTimes(1);
  });
  it('disabled knowledge failover adds no PG reads or completeness checks', async () => {
    const { ai, q } = setup();
    ai.embeddingFailover = false;
    ai.createQueryEmbedding = jest.fn().mockResolvedValue([1, 2]);
    q.hybridSearch.mockResolvedValue([]);
    const prisma: any = { storeKnowledge: { findMany: jest.fn() } };
    const service = new StoreKnowledgeService(prisma, ai, q, {
      rerank: jest.fn().mockResolvedValue([]),
    } as any);
    expect(await service.search('delivery')).toBeNull();
    expect(prisma.storeKnowledge.findMany).not.toHaveBeenCalled();
    expect(q.embeddingIndexComplete).not.toHaveBeenCalled();
    expect(q.validateEmbeddingCollection).not.toHaveBeenCalled();
    expect(q.hybridSearch).toHaveBeenCalledWith(
      'store_knowledge',
      [1, 2],
      'delivery',
      20,
      undefined,
    );
  });
  it('order stock decrement keeps the same index identity; eligibility/text/related metadata changes invalidate it', () => {
    const version = productIndexVersion(product as any);
    expect(
      productIndexVersion({
        ...product,
        stock: 2,
        updatedAt: new Date(),
      } as any),
    ).toBe(version);
    for (const change of [
      { stock: 0 },
      { title: 'changed' },
      { brand: { ...product.brand, name: 'new brand' } },
    ])
      expect(productIndexVersion({ ...product, ...change } as any)).not.toBe(
        version,
      );
  });
  it('updates a product once, indexes both spaces, and stores only the primary vector in PG', async () => {
    const { products, prisma, q, ai } = setup();
    jest.spyOn(products, 'getProductById').mockResolvedValue(product as any);
    await products.update(id, {} as any);
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(q.savePoint.mock.calls.map((c) => c[0])).toEqual([
      'products',
      'products_openai',
      'products',
      'products_openai',
    ]);
    expect(ai.createEmbedding.mock.calls.map((c) => c[1])).toEqual([
      'yandex',
      'openai',
    ]);
    expect(q.savePoint.mock.calls[3][1].payload._source_version).toBe(
      productIndexVersion(product as any),
    );
  });
  it('both embedding outages keep new sparse copies and never repeat product mutation', async () => {
    const { products, prisma, q, ai } = setup();
    jest.spyOn(products, 'getProductById').mockResolvedValue(product as any);
    ai.createEmbedding.mockRejectedValue(
      new EmbeddingRequestError('availability', 'yandex', 503),
    );
    await products.update(id, {} as any);
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.productEmbedding.deleteMany).toHaveBeenCalledTimes(1);
    expect(q.savePoint).toHaveBeenCalledTimes(2);
  });
  it('deletes from both indices after one authoritative PG deletion; Qdrant outage does not replay delete', async () => {
    const { products, prisma, q } = setup();
    jest.spyOn(products, 'getProductById').mockResolvedValue(product as any);
    q.removeIndexPoints.mockRejectedValue(new Error('Qdrant unavailable'));
    await products.delete(id);
    expect(prisma.product.delete).toHaveBeenCalledTimes(1);
    expect(q.removeIndexPoints.mock.calls).toEqual([
      ['products', [id]],
      ['products_openai', [id]],
    ]);
  });
  it('Qdrant outage propagates as search failure before any embedding call', async () => {
    const { ai, prisma, q } = setup();
    const error = new Error('Qdrant unavailable');
    q.validateEmbeddingCollection.mockRejectedValue(error);
    const search = new CurrentStoreProductSearchService(ai, q, null, prisma, {
      resolveCatalogFilters: async () => ({
        brandId: null,
        categoryId: null,
        subcategoryId: null,
      }),
    } as any);
    await expect(
      search.searchProducts({
        semanticQuery: 'shoes',
        filters: Object.fromEntries(
          [
            'gender',
            'type',
            'brand',
            'category',
            'subcategory',
            'color',
            'size',
            'minPrice',
            'maxPrice',
          ].map((k) => [k, null]),
        ),
      } as any),
    ).rejects.toBe(error);
    expect(ai.createEmbedding).not.toHaveBeenCalled();
  });
  it('knowledge search excludes deleted/deactivated/stale records before reranking', async () => {
    const { ai, q } = setup();
    const old = {
      id,
      payload: {
        _source_version: product.updatedAt.toISOString(),
        content: 'old',
      },
    };
    q.hybridSearch.mockResolvedValue([old]);
    const prisma: any = {
      storeKnowledge: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ id, updatedAt: product.updatedAt }])
          .mockResolvedValueOnce([]),
      },
    };
    const reranker: any = { rerank: jest.fn().mockResolvedValue([]) };
    const service = new StoreKnowledgeService(prisma, ai, q, reranker);
    expect(await service.search('return policy')).toBeNull();
    expect(reranker.rerank).toHaveBeenCalledWith(
      'return policy',
      [],
      expect.any(Function),
      1,
    );
  });
});
