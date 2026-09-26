import { Injectable } from '@nestjs/common';

import {
  ProductQdrantPayloadSchema,
  type ProductQdrantPayload,
} from '@/src/ai/schemas/product-qdrant-payload.schema';

import { AiService } from '@/src/ai/ai.service';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import { QdrantCollections } from '@/src/core/qdrant/qdrant.collections';

import { QdrantService } from '@/src/core/qdrant/qdrant.service';

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

import {
  buildCurrentStoreQdrantFilter,
  CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE,
  isCurrentStoreProductEligible,
  matchesCurrentStoreHardFilters,
} from './current-store-hard-filters';

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

      20,

      buildCurrentStoreQdrantFilter(
        productNeed,

        catalog,
      ),
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
        !matchesCurrentStoreHardFilters(
          payload,

          productNeed,

          catalog,
        )
      ) {
        continue;
      }

      seen.add(payload.productId);

      payloads.push(payload);
    }

    if (!payloads.length) {
      return [];
    }

    /**
     * Qdrant — retrieval index.
     *
     * Финальная eligibility проверяется
     * по source of truth — Postgres.
     */
    const rows = await this.prismaService.product.findMany({
      where: {
        id: {
          in: payloads.map((item) => item.productId),
        },

        ...CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE,
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

      if (!row || !isCurrentStoreProductEligible(row)) {
        continue;
      }

      /**
       * Hard constraints повторно
       * проверяются по Postgres.
       */
      if (
        !matchesCurrentStoreHardFilters(
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

    if (candidates.length <= 5) {
      return candidates.map((item) => item.product);
    }

    const reranked = await this.rerankerService.rerank(
      productNeed.semanticQuery,

      candidates,

      (item) => item.payload.searchText,

      5,
    );

    return reranked.slice(0, 5).map(({ item }) => item.product);
  }
}
