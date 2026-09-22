import { Injectable } from '@nestjs/common';

import { CurrentStoreCatalogService } from '@/src/product-consultation/adapters/current-store/current-store-catalog.service';

import { CurrentStoreProductSearchService } from '@/src/product-consultation/adapters/current-store/current-store-product-search.service';

import type { ProductNeed } from '@/src/product-consultation/application/search/product-need.schema';

import type { ProductSearchResult } from '@/src/product-consultation/application/search/product-search-results.schema';

import type { ProductDetails } from '@/src/product-consultation/core/consultation-core.schema';

@Injectable()
export class ProductAgentService {
  constructor(
    private readonly currentStoreCatalogService: CurrentStoreCatalogService,

    private readonly currentStoreProductSearchService: CurrentStoreProductSearchService,
  ) {}

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
}
