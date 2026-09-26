import { describe, expect, it, jest } from '@jest/globals';

import type { ProductNeed } from '../../../application/search/product-need.schema';

import type { ProductSearchResult } from '../../../application/search/product-search-results.schema';

import {
  CurrentStoreSearchSpecAdapter,
  type CurrentStoreProductNeedSearch,
} from '../current-store-search-spec.adapter';

describe('CurrentStoreSearchSpecAdapter', () => {
  it('delegates compiled SearchSpec to existing hybrid search and returns consultation result products', async () => {
    const searchProducts = jest.fn(
      async (productNeed: ProductNeed): Promise<ProductSearchResult> => ({
        productNeed,

        products: [
          {
            id: 'nike-dunk',

            title: 'Nike SB Dunk Low Pro',

            price: '15000',

            image: '',
          },

          {
            id: 'nike-mind',

            title: 'Nike Mind 002',

            price: '23000',

            image: 'https://example.com/nike-mind.jpg',
          },
        ],
      }),
    );

    const productSearch: CurrentStoreProductNeedSearch = {
      searchProducts,
    };

    const adapter = new CurrentStoreSearchSpecAdapter(productSearch);

    const products = await adapter.search({
      version: 1,

      semanticIntent: 'городские кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Nike',

          unit: null,
        },

        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'MAN',

          unit: null,
        },
      ],
    });

    expect(searchProducts).toHaveBeenCalledTimes(1);

    expect(searchProducts).toHaveBeenCalledWith({
      semanticQuery: 'городские кроссовки',

      filters: {
        gender: 'MAN',

        type: null,

        brand: 'Nike',

        category: null,

        subcategory: null,

        color: null,

        size: null,

        minPrice: null,

        maxPrice: null,
      },
    });

    expect(products).toEqual([
      {
        productId: 'nike-dunk',

        title: 'Nike SB Dunk Low Pro',

        price: '15000',

        image: null,
      },

      {
        productId: 'nike-mind',

        title: 'Nike Mind 002',

        price: '23000',

        image: 'https://example.com/nike-mind.jpg',
      },
    ]);
  });

  it('rejects unsupported hard constraint before existing hybrid search is called', async () => {
    const searchProducts = jest.fn(
      async (productNeed: ProductNeed): Promise<ProductSearchResult> => ({
        productNeed,

        products: [],
      }),
    );

    const productSearch: CurrentStoreProductNeedSearch = {
      searchProducts,
    };

    const adapter = new CurrentStoreSearchSpecAdapter(productSearch);

    await expect(
      adapter.search({
        version: 1,

        semanticIntent: 'лёгкие кроссовки',

        category: 'SHOES',

        constraints: [
          {
            attributeId: 'weight',

            operator: 'lte',

            value: 0.5,

            unit: 'kg',
          },
        ],
      }),
    ).rejects.toThrow(
      'unsupported hard constraint weight:lte for current store search',
    );

    /**
     * Ключевой invariant:
     *
     * unsupported hard constraint
     * отклонён ДО обращения
     * к существующему search engine.
     */
    expect(searchProducts).not.toHaveBeenCalled();
  });
});
