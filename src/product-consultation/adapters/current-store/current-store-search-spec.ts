import {
  ProductNeedSchema,
  type ProductNeed,
} from '../../application/search/product-need.schema';

import {
  SearchSpecSchema,
  type SearchConstraint,
  type SearchSpec,
} from '../../core/search/search-spec.schema';

function fail(message: string): never {
  throw new Error(`CurrentStoreSearchSpec: ${message}`);
}

function constraintKey(
  constraint: Pick<SearchConstraint, 'attributeId' | 'operator'>,
): string {
  return `${constraint.attributeId}:${constraint.operator}`;
}

function requireOperator(
  constraint: SearchConstraint,

  expected: SearchConstraint['operator'],
): void {
  if (constraint.operator !== expected) {
    fail(
      `constraint ${constraintKey(
        constraint,
      )} is not executable by current store search; expected operator ${expected}.`,
    );
  }
}

function requireStringValue(constraint: SearchConstraint): string {
  if (typeof constraint.value !== 'string') {
    fail(`constraint ${constraintKey(constraint)} requires string value.`);
  }

  const value = constraint.value.trim();

  if (!value) {
    fail(`constraint ${constraintKey(constraint)} requires non-empty value.`);
  }

  return value;
}

function requireNumberValue(constraint: SearchConstraint): number {
  if (
    typeof constraint.value !== 'number' ||
    !Number.isFinite(constraint.value)
  ) {
    fail(`constraint ${constraintKey(constraint)} requires numeric value.`);
  }

  return constraint.value;
}

function requireProductType(
  constraint: SearchConstraint,
): NonNullable<ProductNeed['filters']['type']> {
  const value = requireStringValue(constraint);

  if (value !== 'SHOES' && value !== 'CLOTHES' && value !== 'ACCESSORIES') {
    fail(`unsupported current-store product type ${value}.`);
  }

  return value;
}

function requireGender(
  constraint: SearchConstraint,
): NonNullable<ProductNeed['filters']['gender']> {
  const value = requireStringValue(constraint);

  if (value !== 'MAN' && value !== 'WOMAN' && value !== 'UNISEX') {
    fail(`unsupported current-store gender ${value}.`);
  }

  return value;
}

/**
 * Компилирует authoritative SearchSpec
 * в существующий current-store ProductNeed.
 *
 * Это compatibility adapter.
 *
 * ProductNeed НЕ становится новым
 * application contract.
 *
 * Каждый SearchSpec constraint здесь
 * должен быть:
 *
 * 1. реально отображён в hard filter;
 * или
 * 2. явно отклонён как unsupported.
 *
 * Нельзя молча переносить hard constraint
 * только в semanticQuery.
 */
export function compileCurrentStoreSearchSpec(
  searchRaw: SearchSpec,
): ProductNeed {
  const search = SearchSpecSchema.parse(searchRaw);

  const filters: ProductNeed['filters'] = {
    gender: null,

    type: null,

    brand: null,

    category: null,

    subcategory: null,

    color: null,

    size: null,

    minPrice: null,

    maxPrice: null,
  };

  let exactPrice: number | null = null;

  let minPrice: number | null = null;

  let maxPrice: number | null = null;

  for (const constraint of search.constraints) {
    switch (constraint.attributeId) {
      case 'brand': {
        requireOperator(constraint, 'eq');

        filters.brand = requireStringValue(constraint);

        break;
      }

      case 'category': {
        requireOperator(constraint, 'eq');

        filters.category = requireStringValue(constraint);

        break;
      }

      case 'subcategory': {
        requireOperator(constraint, 'eq');

        filters.subcategory = requireStringValue(constraint);

        break;
      }

      case 'type': {
        requireOperator(constraint, 'eq');

        filters.type = requireProductType(constraint);

        break;
      }

      case 'gender': {
        requireOperator(constraint, 'eq');

        filters.gender = requireGender(constraint);

        break;
      }

      case 'color': {
        requireOperator(constraint, 'eq');

        filters.color = requireStringValue(constraint);

        break;
      }

      case 'sizes': {
        requireOperator(constraint, 'contains');

        filters.size = requireStringValue(constraint);

        break;
      }

      case 'price': {
        const value = requireNumberValue(constraint);

        switch (constraint.operator) {
          case 'eq': {
            exactPrice = value;

            break;
          }

          case 'gte': {
            minPrice = value;

            break;
          }

          case 'lte': {
            maxPrice = value;

            break;
          }

          default: {
            fail(
              `constraint ${constraintKey(
                constraint,
              )} is not executable by current store search.`,
            );
          }
        }

        break;
      }

      default: {
        /**
         * Очень важный invariant.
         *
         * Например weight, material,
         * purpose и waterProtection
         * существуют в CategoryProfile,
         * но текущий hybrid search
         * не может гарантировать полный
         * hard-filter search по ним.
         *
         * Поэтому не притворяемся,
         * что constraint исполнен.
         */
        fail(
          `unsupported hard constraint ${constraintKey(
            constraint,
          )} for current store search.`,
        );
      }
    }
  }

  /**
   * Legacy current-store resolver
   * при наличии subcategory сейчас
   * не исполняет category независимо.
   *
   * Поэтому до расширения store search
   * нельзя обещать выполнение обоих
   * hard constraints одновременно.
   */
  if (filters.category !== null && filters.subcategory !== null) {
    fail(
      'simultaneous category:eq and subcategory:eq are not executable by current store search.',
    );
  }

  /**
   * price:eq — более сильное условие,
   * чем gte/lte.
   *
   * SearchSpec semantic validation
   * уже гарантирует совместимость
   * numeric constraints.
   */
  if (exactPrice !== null) {
    filters.minPrice = exactPrice;

    filters.maxPrice = exactPrice;
  } else {
    filters.minPrice = minPrice;

    filters.maxPrice = maxPrice;
  }

  return ProductNeedSchema.parse({
    /**
     * semanticIntent остаётся semantic retrieval text.
     *
     * Hard facets НЕ кодируются здесь
     * повторно — они находятся в filters.
     */
    semanticQuery: search.semanticIntent,

    filters,
  });
}
