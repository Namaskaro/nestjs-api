import { Inject, Injectable } from '@nestjs/common';

import type { ProductSearchPort } from '../../application/search/product-search.port';

import type { ProductNeed } from '../../application/search/product-need.schema';

import type { ProductSearchResult } from '../../application/search/product-search-results.schema';

import {
  ProductSearchCapabilitiesSchema,
  type ProductSearchCapabilities,
} from '../../application/search/product-search-capabilities';

import {
  ConsultationResultProductSchema,
  type ConsultationResultProduct,
} from '../../core/results/consultation-results.schema';

import type { SearchSpec } from '../../core/search/search-spec.schema';

import {
  compileCurrentStoreSearchSpec,
  CURRENT_STORE_SEARCH_CAPABILITIES,
} from './current-store-search-spec';

/**
 * Узкий внутренний contract
 * существующего hybrid search.
 */
export interface CurrentStoreProductNeedSearch {
  searchProducts(productNeed: ProductNeed): Promise<ProductSearchResult>;
}

export const CURRENT_STORE_PRODUCT_NEED_SEARCH = Symbol(
  'CURRENT_STORE_PRODUCT_NEED_SEARCH',
);

/**
 * SearchSpec-facing current-store adapter.
 */
@Injectable()
export class CurrentStoreSearchSpecAdapter implements ProductSearchPort {
  constructor(
    @Inject(CURRENT_STORE_PRODUCT_NEED_SEARCH)
    private readonly productSearch: CurrentStoreProductNeedSearch,
  ) {}

  /**
   * Compact deterministic descriptor
   * executable возможностей
   * конкретного магазина.
   *
   * Никакого Qdrant/Prisma здесь
   * наружу не протекает.
   */
  public capabilities(): ProductSearchCapabilities {
    return ProductSearchCapabilitiesSchema.parse(
      CURRENT_STORE_SEARCH_CAPABILITIES,
    );
  }

  public validate(search: SearchSpec): void {
    /**
     * Compiler использует тот же
     * capability rule source,
     * который возвращает capabilities().
     */
    compileCurrentStoreSearchSpec(search);
  }

  public async search(
    search: SearchSpec,
  ): Promise<ConsultationResultProduct[]> {
    const productNeed = compileCurrentStoreSearchSpec(search);

    const result = await this.productSearch.searchProducts(productNeed);

    return result.products.map((product) =>
      ConsultationResultProductSchema.parse({
        productId: product.id,

        title: product.title,

        price: product.price,

        image: product.image.trim() ? product.image : null,
      }),
    );
  }
}
