import {
  productIndexVersion,
  PRODUCT_INDEX_SOURCE_INCLUDE,
} from '@/src/ai/product-index-version';
import { Injectable, Logger } from '@nestjs/common';
import { ReviewsService } from '@/src/modules/reviews/reviews.service';

import {
  ProductQdrantPayloadSchema,
  type ProductQdrantPayload,
} from '@/src/ai/schemas/product-qdrant-payload.schema';

import { AiService } from '@/src/ai/ai.service';
import {
  retrieveWithEmbeddingFallback,
  EmbeddingIndexIncompleteError,
} from '@/src/ai/embedding-retrieval';

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

const PRODUCT_SEARCH_CANDIDATE_LIMIT = 20;

const PRODUCT_SEARCH_RESULT_LIMIT = 6;

export function reviewRatingAdjustment(
  averageRating: number | null,
  count: number,
  weight: number,
): number {
  if (!count || averageRating === null) return 0;
  const smoothed = (count * averageRating + 20 * 3) / (count + 20);
  return (weight * (smoothed - 3)) / 2;
}

@Injectable()
export class CurrentStoreProductSearchService {
  private readonly logger = new Logger(CurrentStoreProductSearchService.name);
  private readonly ratingWeight = Number(
    process.env.REVIEW_RATING_WEIGHT ?? 0.005,
  );

  constructor(
    private readonly aiService: AiService,
    private readonly qdrantService: QdrantService,
    private readonly rerankerService: RerankerService,
    private readonly prismaService: PrismaService,
    private readonly currentStoreCatalogService: CurrentStoreCatalogService,
    private readonly reviews: ReviewsService,
  ) {
    if (
      !Number.isFinite(this.ratingWeight) ||
      this.ratingWeight < 0 ||
      this.ratingWeight > 0.02
    )
      throw new Error('REVIEW_RATING_WEIGHT must be between 0 and 0.02');
  }

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

    const points = await retrieveWithEmbeddingFallback(
      this.aiService,
      this.qdrantService,
      {
        collection: QdrantCollections.products,
        query: productNeed.semanticQuery,
        limit: PRODUCT_SEARCH_CANDIDATE_LIMIT,
        filter: buildCurrentStoreQdrantFilter(productNeed, catalog),
        loadVersions: async () =>
          (
            await this.prismaService.product.findMany({
              where: CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE,
              include: PRODUCT_INDEX_SOURCE_INCLUDE,
            })
          ).map((row) => ({ id: row.id, version: productIndexVersion(row) })),
      },
    );
    const sourceVersions = new Map(
      points.map((point) => [String(point.id), point.payload?._source_version]),
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
        !matchesCurrentStoreHardFilters(payload, productNeed, catalog)
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
    const where = {
      id: {
        in: payloads.map((item) => item.productId),
      },
      ...CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE,
    };
    const currentVersions = new Map<string, string>();
    const rows = this.aiService.embeddingFailover
      ? await this.prismaService.product
          .findMany({ where, include: PRODUCT_INDEX_SOURCE_INCLUDE })
          .then((rows) => {
            for (const row of rows)
              currentVersions.set(row.id, productIndexVersion(row));
            return rows;
          })
      : await this.prismaService.product.findMany({
          where,
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

      if (!row || !isCurrentStoreProductEligible(row)) {
        continue;
      }
      if (
        this.aiService.embeddingFailover &&
        sourceVersions.get(row.id) !== currentVersions.get(row.id)
      )
        throw new EmbeddingIndexIncompleteError(QdrantCollections.products);

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

    if (candidates.length <= 1) {
      return candidates.map((item) => item.product);
    }

    try {
      const reranked = await this.rerankerService.rerank(
        productNeed.semanticQuery,
        candidates,
        (item) => item.payload.searchText,
        PRODUCT_SEARCH_RESULT_LIMIT,
      );

      if (!this.ratingWeight) return reranked.map(({ item }) => item.product);
      const stats = await this.reviews
        .getProductStatsBatch(reranked.map(({ item }) => item.product.id))
        .catch(() => {
          this.logger.warn(
            'Review rating statistics unavailable; preserving catalog top-6 order',
          );
          return new Map();
        });
      return reranked
        .map(({ item, score }, rank) => {
          const rating = stats.get(item.product.id);
          return {
            item,
            rank,
            score:
              score +
              reviewRatingAdjustment(
                rating?.averageRating ?? null,
                rating?.ratingCount ?? 0,
                this.ratingWeight,
              ),
          };
        })
        .sort((a, b) => b.score - a.score || a.rank - b.rank)
        .map(({ item }) => item.product);
    } catch (error) {
      this.logger.warn(
        `Reranker failed, fallback to hybrid-search order: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return candidates
        .slice(0, PRODUCT_SEARCH_RESULT_LIMIT)
        .map((item) => item.product);
    }
  }
}
