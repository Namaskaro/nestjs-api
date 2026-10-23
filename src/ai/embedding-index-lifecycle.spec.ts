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
