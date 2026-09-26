import { describe, expect, it } from '@jest/globals';

import { compileCurrentStoreSearchSpec } from '../current-store-search-spec';

import {
  buildCurrentStoreQdrantFilter,
  CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE,
  isCurrentStoreProductEligible,
  matchesCurrentStoreHardFilters,
  type CurrentStoreHardFilterValues,
} from '../current-store-hard-filters';

describe('CurrentStore SearchSpec execution contract', () => {
  it('executes supported SearchSpec facets as Qdrant hard filters', () => {
    const need = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'лаконичные городские кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'MAN',

          unit: null,
        },

        {
          attributeId: 'type',

          operator: 'eq',

          value: 'SHOES',

          unit: null,
        },

        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Nike',

          unit: null,
        },

        {
          attributeId: 'color',

          operator: 'eq',

          value: 'Зелёный',

          unit: null,
        },

        {
          attributeId: 'sizes',

          operator: 'contains',

          value: '43',

          unit: null,
        },

        {
          attributeId: 'price',

          operator: 'gte',

          value: 10000,

          unit: null,
        },

        {
          attributeId: 'price',

          operator: 'lte',

          value: 20000,

          unit: null,
        },
      ],
    });

    const filter = buildCurrentStoreQdrantFilter(
      need,

      {
        brandId: 'brand-nike',

        categoryId: null,

        subcategoryId: null,
      },
    );

    expect(filter).toEqual({
      must: [
        {
          key: 'inStock',

          match: {
            value: true,
          },
        },

        {
          key: 'gender',

          match: {
            value: 'MAN',
          },
        },

        {
          key: 'type',

          match: {
            value: 'SHOES',
          },
        },

        {
          key: 'brandId',

          match: {
            value: 'brand-nike',
          },
        },

        {
          key: 'colorKey',

          match: {
            value: 'зеленый',
          },
        },

        {
          key: 'sizes',

          match: {
            value: '43',
          },
        },

        {
          key: 'price',

          range: {
            gte: 10000,

            lte: 20000,
          },
        },
      ],
    });
  });

  it('executes catalog category through resolved categoryId', () => {
    const need = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'повседневная обувь',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'category',

          operator: 'eq',

          value: 'Обувь',

          unit: null,
        },
      ],
    });

    const filter = buildCurrentStoreQdrantFilter(
      need,

      {
        brandId: null,

        categoryId: 'category-shoes',

        subcategoryId: null,
      },
    );

    expect(filter.must).toContainEqual({
      key: 'categoryId',

      match: {
        value: 'category-shoes',
      },
    });
  });

  it('executes catalog subcategory through resolved subcategoryId', () => {
    const need = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'городская обувь',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'subcategory',

          operator: 'eq',

          value: 'Кроссовки',

          unit: null,
        },
      ],
    });

    const filter = buildCurrentStoreQdrantFilter(
      need,

      {
        brandId: null,

        categoryId: null,

        subcategoryId: 'subcategory-sneakers',
      },
    );

    expect(filter.must).toContainEqual({
      key: 'subcategoryId',

      match: {
        value: 'subcategory-sneakers',
      },
    });

    expect(filter.must).not.toContainEqual(
      expect.objectContaining({
        key: 'categoryId',
      }),
    );
  });

  it('executes price:eq as an exact Qdrant numeric range', () => {
    const need = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'price',

          operator: 'eq',

          value: 15000,

          unit: null,
        },
      ],
    });

    expect(
      buildCurrentStoreQdrantFilter(
        need,

        {
          brandId: null,

          categoryId: null,

          subcategoryId: null,
        },
      ),
    ).toEqual({
      must: [
        {
          key: 'inStock',

          match: {
            value: true,
          },
        },

        {
          key: 'price',

          range: {
            gte: 15000,

            lte: 15000,
          },
        },
      ],
    });
  });

  it('rechecks supported hard filters against source-of-truth values', () => {
    const need = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'городские кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'MAN',

          unit: null,
        },

        {
          attributeId: 'type',

          operator: 'eq',

          value: 'SHOES',

          unit: null,
        },

        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Nike',

          unit: null,
        },

        {
          attributeId: 'color',

          operator: 'eq',

          value: 'зелёный',

          unit: null,
        },

        {
          attributeId: 'sizes',

          operator: 'contains',

          value: '43',

          unit: null,
        },

        {
          attributeId: 'price',

          operator: 'gte',

          value: 10000,

          unit: null,
        },

        {
          attributeId: 'price',

          operator: 'lte',

          value: 20000,

          unit: null,
        },
      ],
    });

    const catalog = {
      brandId: 'brand-nike',

      categoryId: null,

      subcategoryId: null,
    };

    const matching: CurrentStoreHardFilterValues = {
      inStock: true,

      gender: 'MAN',

      type: 'SHOES',

      brandId: 'brand-nike',

      categoryId: 'category-shoes',

      subcategoryId: 'subcategory-sneakers',

      colorKey: 'зеленый',

      sizes: ['42', '43', '44'],

      price: 15000,
    };

    expect(
      matchesCurrentStoreHardFilters(
        matching,

        need,

        catalog,
      ),
    ).toBe(true);

    expect(
      matchesCurrentStoreHardFilters(
        {
          ...matching,

          brandId: 'brand-adidas',
        },

        need,

        catalog,
      ),
    ).toBe(false);

    expect(
      matchesCurrentStoreHardFilters(
        {
          ...matching,

          colorKey: 'синий',
        },

        need,

        catalog,
      ),
    ).toBe(false);

    expect(
      matchesCurrentStoreHardFilters(
        {
          ...matching,

          sizes: ['40', '41'],
        },

        need,

        catalog,
      ),
    ).toBe(false);

    expect(
      matchesCurrentStoreHardFilters(
        {
          ...matching,

          price: 25000,
        },

        need,

        catalog,
      ),
    ).toBe(false);
  });

  it('keeps availability as server-owned eligibility instead of SearchSpec filter', () => {
    const need = compileCurrentStoreSearchSpec({
      version: 1,

      semanticIntent: 'городские кроссовки',

      category: 'SHOES',

      constraints: [],
    });

    const filter = buildCurrentStoreQdrantFilter(
      need,

      {
        brandId: null,

        categoryId: null,

        subcategoryId: null,
      },
    );

    expect(filter).toEqual({
      must: [
        {
          key: 'inStock',

          match: {
            value: true,
          },
        },
      ],
    });
  });

  it('uses one current-store eligibility query for both search and fresh product details', () => {
    expect(CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE).toEqual({
      inStock: true,

      stock: {
        gt: 0,
      },
    });
  });

  it('treats an out-of-stock product as no longer eligible even if it existed in an earlier result snapshot', () => {
    expect(
      isCurrentStoreProductEligible({
        inStock: true,

        stock: 3,
      }),
    ).toBe(true);

    expect(
      isCurrentStoreProductEligible({
        inStock: false,

        stock: 3,
      }),
    ).toBe(false);

    expect(
      isCurrentStoreProductEligible({
        inStock: true,

        stock: 0,
      }),
    ).toBe(false);

    expect(
      isCurrentStoreProductEligible({
        inStock: false,

        stock: 0,
      }),
    ).toBe(false);
  });
});
