import type { QdrantFilter } from '@/src/core/qdrant/qdrant.service';

import { normalizeSearchFilterValue } from '@/src/shared/utils/normalize-search-filter-value';

import type { ProductNeed } from '@/src/product-consultation/application/search/product-need.schema';

import type { ResolvedStoreCatalog } from './current-store.mapping';

/**
 * Единственное правило current-store,
 * определяющее, можно ли сейчас
 * использовать товар как актуального
 * кандидата для покупки/консультации.
 *
 * Это НЕ SearchSpec.
 * Это server-owned catalog eligibility.
 */
export const CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE = {
  inStock: true,

  stock: {
    gt: 0,
  },
} as const;

export type CurrentStoreAvailabilityValues = {
  inStock: boolean;

  stock: number;
};

export function isCurrentStoreProductEligible(
  values: CurrentStoreAvailabilityValues,
): boolean {
  return (
    values.inStock === true &&
    Number.isSafeInteger(values.stock) &&
    values.stock > 0
  );
}

export type CurrentStoreHardFilterValues = {
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

/**
 * Строит hard filter для retrieval index.
 *
 * Availability не приходит из SearchSpec.
 *
 * inStock=true здесь является
 * server-owned catalog eligibility rule.
 */
export function buildCurrentStoreQdrantFilter(
  need: ProductNeed,

  catalog: ResolvedStoreCatalog,
): QdrantFilter {
  const {
    gender,

    type,

    color,

    size,

    minPrice,

    maxPrice,
  } = need.filters;

  const {
    brandId,

    categoryId,

    subcategoryId,
  } = catalog;

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

/**
 * Повторная hard-filter проверка
 * после чтения актуального Product.
 */
export function matchesCurrentStoreHardFilters(
  values: CurrentStoreHardFilterValues,

  need: ProductNeed,

  catalog: ResolvedStoreCatalog,
): boolean {
  const {
    gender,

    type,

    color,

    size,

    minPrice,

    maxPrice,
  } = need.filters;

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

  if (catalog.subcategoryId && values.subcategoryId !== catalog.subcategoryId) {
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
