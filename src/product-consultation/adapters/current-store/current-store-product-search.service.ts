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
  ProductItemSchema,
  type ProductItem,
} from '@/src/product-consultation/application/agent/product-agent-result.schema';

import type { ProductNeed } from '@/src/product-consultation/application/search/product-need.schema';

import {
  ProductSearchResultSchema,
  type ProductSearchResult,
} from '@/src/product-consultation/application/search/product-search-results.schema';

import { CurrentStoreCatalogService } from './current-store-catalog.service';

import type { ResolvedStoreCatalog } from './current-store.mapping';

const RRF_CANDIDATE_LIMIT = 20;

const FINAL_PRODUCT_LIMIT = 5;

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
export class CurrentStoreProductSearchService {
  constructor(
    private readonly aiService: AiService,

    private readonly qdrantService: QdrantService,

    private readonly rerankerService: RerankerService,

    private readonly prismaService: PrismaService,

    private readonly currentStoreCatalogService: CurrentStoreCatalogService,
  ) {}

  public async searchProducts(
    productNeed: ProductNeed,
  ): Promise<ProductSearchResult> {
    return ProductSearchResultSchema.parse({
      productNeed,

      products: await this.hybridProductSearch(productNeed),
    });
  }

  private async hybridProductSearch(
    productNeed: ProductNeed,
  ): Promise<ProductItem[]> {
    const catalog = await this.currentStoreCatalogService.resolveCatalogFilters(
      productNeed,
    );

    if (!catalog) {
      return [];
    }

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

      if (!parsed.success) {
        continue;
      }

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

    if (!payloads.length) {
      return [];
    }

    /*
     * Qdrant — поисковый индекс.
     *
     * После retrieval повторно читаем актуальные данные
     * из source of truth — Postgres.
     */
    const rows = await this.prismaService.product.findMany({
      where: {
        id: {
          in: payloads.map((item) => item.productId),
        },

        inStock: true,

        stock: {
          gt: 0,
        },
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

        subcategory: {
          select: {
            categoryId: true,
          },
        },
      },
    });

    const byId = new Map(rows.map((row) => [row.id, row]));

    const candidates: {
      payload: ProductQdrantPayload;

      product: ProductItem;
    }[] = [];

    for (const payload of payloads) {
      const row = byId.get(payload.productId);

      if (!row || !row.inStock || row.stock <= 0) {
        continue;
      }

      /*
       * Hard filters проверяются повторно по source of truth.
       *
       * Это защищает от ситуации, когда Qdrant payload
       * немного отстал от Postgres.
       */
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
        candidates.push({
          payload,

          product: product.data,
        });
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

    catalog: ResolvedStoreCatalog,
  ): QdrantFilter {
    const { gender, type, color, size, minPrice, maxPrice } = need.filters;

    const { brandId, categoryId, subcategoryId } = catalog;

    return {
      must: [
        {
          key: 'inStock',

          match: {
            value: true,
          },
        },

        ...(gender
          ? [
              {
                key: 'gender',

                match: {
                  value: gender,
                },
              },
            ]
          : []),

        ...(type
          ? [
              {
                key: 'type',

                match: {
                  value: type,
                },
              },
            ]
          : []),

        ...(brandId
          ? [
              {
                key: 'brandId',

                match: {
                  value: brandId,
                },
              },
            ]
          : []),

        ...(subcategoryId
          ? [
              {
                key: 'subcategoryId',

                match: {
                  value: subcategoryId,
                },
              },
            ]
          : categoryId
          ? [
              {
                key: 'categoryId',

                match: {
                  value: categoryId,
                },
              },
            ]
          : []),

        ...(color
          ? [
              {
                key: 'colorKey',

                match: {
                  value: normalizeSearchFilterValue(color),
                },
              },
            ]
          : []),

        ...(size
          ? [
              {
                key: 'sizes',

                match: {
                  value: size,
                },
              },
            ]
          : []),

        ...(minPrice !== null || maxPrice !== null
          ? [
              {
                key: 'price',

                range: {
                  ...(minPrice !== null
                    ? {
                        gte: minPrice,
                      }
                    : {}),

                  ...(maxPrice !== null
                    ? {
                        lte: maxPrice,
                      }
                    : {}),
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

    catalog: ResolvedStoreCatalog,
  ): boolean {
    const { gender, type, color, size, minPrice, maxPrice } = need.filters;

    if (!values.inStock) {
      return false;
    }

    if (gender && values.gender !== gender) {
      return false;
    }

    if (type && values.type !== type) {
      return false;
    }

    if (catalog.brandId && values.brandId !== catalog.brandId) {
      return false;
    }

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

    if (size && !values.sizes.includes(size)) {
      return false;
    }

    if (!Number.isFinite(values.price) || values.price < 0) {
      return false;
    }

    if (minPrice !== null && values.price < minPrice) {
      return false;
    }

    if (maxPrice !== null && values.price > maxPrice) {
      return false;
    }

    return true;
  }
}
