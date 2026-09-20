import { Injectable } from '@nestjs/common';
import {
  ProductQdrantPayloadSchema,
  type ProductQdrantPayload,
} from '@/src/ai/schemas/product-qdrant-payload.schema';
import { AiService } from '@/src/ai/ai.service';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { QdrantCollections } from '@/src/core/qdrant/qdrant.collections';
import {
  QdrantService,
  type QdrantFilter,
} from '@/src/core/qdrant/qdrant.service';
import { RerankerService } from '@/src/core/reranker/reranker.service';
import { normalizeSearchFilterValue } from '@/src/shared/utils/normalize-search-filter-value';
import {
  buildCurrentStoreBinding,
  type ResolvedStoreCatalog,
} from '../../../product-consultation/adapters/current-store/current-store.mapping';
import { toProductDetailsMany } from '../../../product-consultation/adapters/current-store/current-store-product.adapter';
import type { ProductDetails } from './consultation-core/consultation-core.schema';
import {
  ProductItemSchema,
  type ProductItem,
} from '../../../product-consultation/application/agent/product-agent-result.schema';
import type { ProductNeed } from '../../../product-consultation/application/search/product-need.schema';
import {
  ProductSearchResultSchema,
  type ProductSearchResult,
} from './schemas/product-search-results.schema';

const RRF_CANDIDATE_LIMIT = 20;
const FINAL_PRODUCT_LIMIT = 5;

type CatalogFilters = {
  brandId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
};

type Brand = { id: string; name: string };

type FilterValues = {
  inStock: boolean;
  gender: string;
  type: string;
  brandId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  colorKey: string | null;
  sizes: readonly string[];
  price: number;
};

@Injectable()
export class ProductAgentService {
  private readonly exactBrands = new Map<
    string,
    { until: number; value: Brand | null }
  >();

  constructor(
    private readonly aiService: AiService,
    private readonly qdrantService: QdrantService,
    private readonly rerankerService: RerankerService,
    private readonly prismaService: PrismaService,
  ) {}

  public async searchProducts(
    productNeed: ProductNeed,
  ): Promise<ProductSearchResult> {
    return ProductSearchResultSchema.parse({
      productNeed,
      products: await this.hybridProductSearch(productNeed),
    });
  }

  public async resolveBrandName(value: string): Promise<string | null> {
    return (await this.findExactBrand(value))?.name ?? null;
  }

  public async getConsultationBinding(productNeed: ProductNeed) {
    const { brand, category, subcategory } = productNeed.filters;

    const [brandId, subcategoryId, categoryId] = await Promise.all([
      this.resolveBrandId(brand),
      subcategory
        ? this.resolveSubcategoryId(subcategory)
        : Promise.resolve(null),
      subcategory ? Promise.resolve(null) : this.resolveCategoryId(category),
    ]);

    const resolved: ResolvedStoreCatalog = {
      brandId,
      categoryId,
      subcategoryId,
    };

    return buildCurrentStoreBinding(productNeed.filters, resolved);
  }

  public async getProductDetails(
    productIds: readonly string[],
  ): Promise<ProductDetails[]> {
    const ids = [...new Set(productIds)];

    if (!ids.length) return [];

    if (ids.length > 250) {
      throw new Error('ProductAgent: превышен лимит batch-чтения товаров');
    }

    const rows = await this.prismaService.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        description: true,
        price: true,
        discount: true,
        images: true,
        sizes: true,
        color: true,
        gender: true,
        type: true,
        inStock: true,
        stock: true,
        details: true,
        updatedAt: true,
        brand: { select: { id: true, name: true } },
        subcategory: {
          select: {
            id: true,
            name: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
    });

    const byId = new Map(
      toProductDetailsMany(rows, new Date().toISOString()).map((product) => [
        product.id,
        product,
      ]),
    );

    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  private async hybridProductSearch(
    productNeed: ProductNeed,
  ): Promise<ProductItem[]> {
    const catalog = await this.resolveCatalogFilters(productNeed);

    if (!catalog) return [];

    const embedding = await this.aiService.createQueryEmbedding(
      productNeed.semanticQuery,
    );

    const points = await this.qdrantService.hybridSearch(
      QdrantCollections.products,
      embedding,
      productNeed.semanticQuery,
      RRF_CANDIDATE_LIMIT,
      this.buildQdrantFilter(productNeed, catalog),
    );

    const seen = new Set<string>();
    const payloads: ProductQdrantPayload[] = [];

    for (const point of points) {
      const parsed = ProductQdrantPayloadSchema.safeParse(point.payload);

      if (!parsed.success) continue;

      const payload = parsed.data;

      if (
        seen.has(payload.productId) ||
        !this.matchesHardFilters(payload, productNeed, catalog)
      ) {
        continue;
      }

      seen.add(payload.productId);
      payloads.push(payload);
    }

    if (!payloads.length) return [];

    const rows = await this.prismaService.product.findMany({
      where: {
        id: { in: payloads.map((item) => item.productId) },
        inStock: true,
        stock: { gt: 0 },
      },
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

    const byId = new Map(rows.map((row) => [row.id, row]));
    const candidates: {
      payload: ProductQdrantPayload;
      product: ProductItem;
    }[] = [];

    for (const payload of payloads) {
      const row = byId.get(payload.productId);

      if (!row || !row.inStock || row.stock <= 0) continue;

      if (
        !this.matchesHardFilters(
          {
            inStock: row.inStock,
            gender: row.gender,
            type: row.type,
            brandId: row.brandId,
            subcategoryId: row.subcategoryId,
            categoryId: row.subcategory?.categoryId ?? null,
            colorKey:
              row.color === null ? null : normalizeSearchFilterValue(row.color),
            sizes: row.sizes,
            price: row.price.trim() ? Number(row.price) : Number.NaN,
          },
          productNeed,
          catalog,
        )
      ) {
        continue;
      }

      const product = ProductItemSchema.safeParse({
        id: row.id,
        title: row.title,
        price: row.price,
        image: row.images[0] ?? '',
      });

      if (product.success) {
        candidates.push({ payload, product: product.data });
      }
    }

    if (candidates.length <= FINAL_PRODUCT_LIMIT) {
      return candidates.map((item) => item.product);
    }

    const reranked = await this.rerankerService.rerank(
      productNeed.semanticQuery,
      candidates,
      (item) => item.payload.searchText,
      FINAL_PRODUCT_LIMIT,
    );

    return reranked
      .slice(0, FINAL_PRODUCT_LIMIT)
      .map(({ item }) => item.product);
  }

  private buildQdrantFilter(
    need: ProductNeed,
    catalog: CatalogFilters,
  ): QdrantFilter {
    const { gender, type, color, size, minPrice, maxPrice } = need.filters;
    const { brandId, categoryId, subcategoryId } = catalog;

    return {
      must: [
        { key: 'inStock', match: { value: true } },
        ...(gender ? [{ key: 'gender', match: { value: gender } }] : []),
        ...(type ? [{ key: 'type', match: { value: type } }] : []),
        ...(brandId ? [{ key: 'brandId', match: { value: brandId } }] : []),
        ...(subcategoryId
          ? [{ key: 'subcategoryId', match: { value: subcategoryId } }]
          : categoryId
          ? [{ key: 'categoryId', match: { value: categoryId } }]
          : []),
        ...(color
          ? [
              {
                key: 'colorKey',
                match: { value: normalizeSearchFilterValue(color) },
              },
            ]
          : []),
        ...(size ? [{ key: 'sizes', match: { value: size } }] : []),
        ...(minPrice !== null || maxPrice !== null
          ? [
              {
                key: 'price',
                range: {
                  ...(minPrice !== null ? { gte: minPrice } : {}),
                  ...(maxPrice !== null ? { lte: maxPrice } : {}),
                },
              },
            ]
          : []),
      ],
    } satisfies QdrantFilter;
  }

  private matchesHardFilters(
    values: FilterValues,
    need: ProductNeed,
    catalog: CatalogFilters,
  ): boolean {
    const { gender, type, color, size, minPrice, maxPrice } = need.filters;

    if (!values.inStock) return false;
    if (gender && values.gender !== gender) return false;
    if (type && values.type !== type) return false;
    if (catalog.brandId && values.brandId !== catalog.brandId) return false;

    if (
      catalog.subcategoryId &&
      values.subcategoryId !== catalog.subcategoryId
    ) {
      return false;
    }

    if (
      !catalog.subcategoryId &&
      catalog.categoryId &&
      values.categoryId !== catalog.categoryId
    ) {
      return false;
    }

    if (color && values.colorKey !== normalizeSearchFilterValue(color)) {
      return false;
    }

    if (size && !values.sizes.includes(size)) return false;
    if (!Number.isFinite(values.price) || values.price < 0) return false;
    if (minPrice !== null && values.price < minPrice) return false;
    if (maxPrice !== null && values.price > maxPrice) return false;

    return true;
  }

  private async resolveCatalogFilters(
    need: ProductNeed,
  ): Promise<CatalogFilters | null> {
    const { brand, category, subcategory } = need.filters;

    const [brandId, subcategoryId, categoryId] = await Promise.all([
      this.resolveBrandId(brand),
      subcategory
        ? this.resolveSubcategoryId(subcategory)
        : Promise.resolve(null),
      subcategory ? Promise.resolve(null) : this.resolveCategoryId(category),
    ]);

    if (brand && !brandId) return null;
    if (subcategory && !subcategoryId) return null;
    if (!subcategory && category && !categoryId) return null;

    return { brandId, categoryId, subcategoryId };
  }

  private async findExactBrand(value: string): Promise<Brand | null> {
    const name = value.trim();

    if (!name) return null;

    const key = name.toLocaleLowerCase('ru-RU');
    const now = Date.now();
    const cached = this.exactBrands.get(key);

    if (cached && cached.until > now) return cached.value;

    for (const [cacheKey, entry] of this.exactBrands) {
      if (entry.until <= now) this.exactBrands.delete(cacheKey);
    }

    const result = await this.prismaService.brand.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });

    while (this.exactBrands.size >= 128) {
      this.exactBrands.delete(this.exactBrands.keys().next().value!);
    }

    this.exactBrands.set(key, {
      until: Date.now() + 30_000,
      value: result,
    });

    return result;
  }

  private async resolveBrandId(value: string | null): Promise<string | null> {
    if (!value) return null;

    const exact = await this.findExactBrand(value);

    if (exact) return exact.id;

    const candidates = await this.prismaService.brand.findMany({
      where: { name: { contains: value, mode: 'insensitive' } },
      select: { id: true },
      take: 2,
    });

    return candidates.length === 1 ? candidates[0].id : null;
  }

  private async resolveCategoryId(
    value: string | null,
  ): Promise<string | null> {
    if (!value) return null;

    const exact = await this.prismaService.category.findFirst({
      where: { name: { equals: value, mode: 'insensitive' } },
      select: { id: true },
    });

    if (exact) return exact.id;

    const candidates = await this.prismaService.category.findMany({
      where: { name: { contains: value, mode: 'insensitive' } },
      select: { id: true },
      take: 2,
    });

    return candidates.length === 1 ? candidates[0].id : null;
  }

  private async resolveSubcategoryId(value: string): Promise<string | null> {
    const exact = await this.prismaService.subcategory.findFirst({
      where: { name: { equals: value, mode: 'insensitive' } },
      select: { id: true },
    });

    if (exact) return exact.id;

    const candidates = await this.prismaService.subcategory.findMany({
      where: { name: { contains: value, mode: 'insensitive' } },
      select: { id: true },
      take: 2,
    });

    return candidates.length === 1 ? candidates[0].id : null;
  }
}
