import { Inject, Injectable } from '@nestjs/common';

import type { ProductSearchPort } from '../../application/search/product-search.port';

import type { ProductNeed } from '../../application/search/product-need.schema';

import type { ProductSearchResult } from '../../application/search/product-search-results.schema';

import {
  ConsultationResultProductSchema,
  type ConsultationResultProduct,
} from '../../core/results/consultation-results.schema';

import type { SearchSpec } from '../../core/search/search-spec.schema';

import { compileCurrentStoreSearchSpec } from './current-store-search-spec';

/**
 * Узкий внутренний contract существующего
 * current-store hybrid search.
 *
 * Новый SearchSpec adapter не должен
 * зависеть от concrete service class,
 * Prisma, Qdrant или других деталей
 * legacy implementation.
 */
export interface CurrentStoreProductNeedSearch {
  searchProducts(productNeed: ProductNeed): Promise<ProductSearchResult>;
}

/**
 * DI token для существующего
 * ProductNeed-based current-store search.
 */
export const CURRENT_STORE_PRODUCT_NEED_SEARCH = Symbol(
  'CURRENT_STORE_PRODUCT_NEED_SEARCH',
);

/**
 * Новый SearchSpec-facing adapter.
 *
 * SearchSpec
 *   ↓
 * deterministic compilation
 *   ↓
 * existing ProductNeed-based hybrid search
 *   ↓
 * canonical ConsultationResultProduct[].
 */
@Injectable()
export class CurrentStoreSearchSpecAdapter implements ProductSearchPort {
  constructor(
    @Inject(CURRENT_STORE_PRODUCT_NEED_SEARCH)
    private readonly productSearch: CurrentStoreProductNeedSearch,
  ) {}

  public validate(search: SearchSpec): void {
    /**
     * Compiler является одновременно
     * capability validation:
     *
     * каждый hard constraint либо
     * компилируется в реально
     * поддерживаемый store filter,
     * либо deterministic reject.
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
