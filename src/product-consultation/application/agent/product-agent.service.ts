import { Injectable } from '@nestjs/common';

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
  ) {}

  public capabilities(): ProductSearchCapabilities {
    return this.currentStoreSearchSpecAdapter.capabilities();
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
}
