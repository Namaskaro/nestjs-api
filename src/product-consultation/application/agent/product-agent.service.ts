import { Injectable } from '@nestjs/common';
import { ReviewsService } from '@/src/modules/reviews/reviews.service';
import {
  ReviewIndexService,
  type ReviewSourceRef,
} from '@/src/modules/reviews/review-index.service';

import { CurrentStoreCatalogService } from '@/src/product-consultation/adapters/current-store/current-store-catalog.service';

import { CurrentStoreProductSearchService } from '@/src/product-consultation/adapters/current-store/current-store-product-search.service';

import { CurrentStoreSearchSpecAdapter } from '@/src/product-consultation/adapters/current-store/current-store-search-spec.adapter';

import type { ProductNeed } from '@/src/product-consultation/application/search/product-need.schema';

import type { ProductSearchResult } from '@/src/product-consultation/application/search/product-search-results.schema';

import type { ProductSearchPort } from '@/src/product-consultation/application/search/product-search.port';

import type { ProductSearchCapabilities } from '@/src/product-consultation/application/search/product-search-capabilities';

import type { ProductDetails } from '@/src/product-consultation/core/consultation-core.schema';

import type { ConsultationResultProduct } from '@/src/product-consultation/core/results/consultation-results.schema';

import type { SearchSpec } from '@/src/product-consultation/core/search/search-spec.schema';

@Injectable()
export class ProductAgentService implements ProductSearchPort {
  constructor(
    private readonly currentStoreCatalogService: CurrentStoreCatalogService,

    private readonly currentStoreProductSearchService: CurrentStoreProductSearchService,

    private readonly currentStoreSearchSpecAdapter: CurrentStoreSearchSpecAdapter,
    private readonly reviews: ReviewsService,
    private readonly reviewIndex: ReviewIndexService,
  ) {}

  public capabilities(): ProductSearchCapabilities {
    return this.currentStoreSearchSpecAdapter.capabilities();
  }

  public getReviewExperience(productIds: readonly string[]) {
    return this.reviews.getReviewExperience(productIds);
  }

  public searchReviews(productId: string, query: string, signal?: AbortSignal) {
    return this.reviewIndex.search(productId, query, signal);
  }

  public async getProductRatings(productIds: readonly string[]) {
    const stats = await this.reviews.getProductStatsBatch(productIds);
    return new Map([...stats].map(([id, value]) => [id, value.averageRating]));
  }

  public resolveReviewSources(
    productId: string,
    refs: readonly ReviewSourceRef[],
  ) {
    return this.reviewIndex.resolveSources(productId, refs);
  }

  public validate(search: SearchSpec): void {
    this.currentStoreSearchSpecAdapter.validate(search);
  }

  public search(search: SearchSpec): Promise<ConsultationResultProduct[]> {
    return this.currentStoreSearchSpecAdapter.search(search);
  }

  public searchProducts(
    productNeed: ProductNeed,
  ): Promise<ProductSearchResult> {
    return this.currentStoreProductSearchService.searchProducts(productNeed);
  }

  public resolveBrandName(value: string): Promise<string | null> {
    return this.currentStoreCatalogService.resolveBrandName(value);
  }

  public getConsultationBinding(productNeed: ProductNeed) {
    return this.currentStoreCatalogService.getConsultationBinding(productNeed);
  }

  public getProductDetails(
    productIds: readonly string[],
  ): Promise<ProductDetails[]> {
    return this.currentStoreCatalogService.getProductDetails(productIds);
  }

  public getProductSemanticRepresentations(productIds: readonly string[]) {
    return this.currentStoreCatalogService.getProductSemanticRepresentations(
      productIds,
    );
  }
}
