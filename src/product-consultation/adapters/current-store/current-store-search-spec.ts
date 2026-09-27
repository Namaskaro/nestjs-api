import {
  ProductNeedSchema,
  type ProductNeed,
} from '../../application/search/product-need.schema';

import {
  ProductSearchCapabilitiesSchema,
  type ProductSearchConstraintCapability,
} from '../../application/search/product-search-capabilities';

import {
  SearchSpecSchema,
  type SearchConstraint,
  type SearchSpec,
} from '../../core/search/search-spec.schema';

type CurrentStoreProductType = NonNullable<ProductNeed['filters']['type']>;

type CurrentStoreGender = NonNullable<ProductNeed['filters']['gender']>;

const CURRENT_STORE_CONSTRAINT_CAPABILITIES: ProductSearchConstraintCapability[] =
  [
    {
      attributeId: 'brand',

      operators: ['eq'],

      modelVisible: true,
    },

    {
      attributeId: 'category',

      operators: ['eq'],

      modelVisible: true,
    },

    {
      attributeId: 'subcategory',

      operators: ['eq'],

      modelVisible: true,
    },

    {
      attributeId: 'type',

      operators: ['eq'],

      modelVisible: false,
    },

    {
      attributeId: 'gender',

      operators: ['eq'],

      modelVisible: true,
    },

    {
      attributeId: 'color',

      operators: ['eq'],

      modelVisible: true,
    },

    {
      attributeId: 'sizes',

      operators: ['contains'],

      modelVisible: true,
    },

    {
      attributeId: 'price',

      operators: ['eq', 'gte', 'lte'],

      modelVisible: true,
    },
  ];

export const CURRENT_STORE_SEARCH_CAPABILITIES =
  ProductSearchCapabilitiesSchema.parse({
    profileIds: ['SHOES', 'CLOTHES', 'ACCESSORIES'],

    constraints: CURRENT_STORE_CONSTRAINT_CAPABILITIES,

    maxConstraints: null,
  });

const CURRENT_STORE_CAPABILITY_BY_ATTRIBUTE = new Map(
  CURRENT_STORE_SEARCH_CAPABILITIES.constraints.map(
    (capability) => [capability.attributeId, capability] as const,
  ),
);

function fail(message: string): never {
  throw new Error(`CurrentStoreSearchSpec: ${message}`);
}

function constraintKey(
  constraint: Pick<SearchConstraint, 'attributeId' | 'operator'>,
): string {
  return `${constraint.attributeId}:${constraint.operator}`;
}

function assertCurrentStoreConstraintCapability(
  constraint: SearchConstraint,
): void {
  const capability = CURRENT_STORE_CAPABILITY_BY_ATTRIBUTE.get(
    constraint.attributeId,
  );

  if (!capability) {
    fail(
      `unsupported hard constraint ${constraintKey(
        constraint,
      )} for current store search.`,
    );
  }

  if (capability.operators.includes(constraint.operator)) {
    return;
  }

  if (capability.operators.length === 1) {
    fail(
      `constraint ${constraintKey(
        constraint,
      )} is not executable by current store search; expected operator ${
        capability.operators[0]
      }.`,
    );
  }

  fail(
    `constraint ${constraintKey(
      constraint,
    )} is not executable by current store search; supported operators: ${capability.operators.join(
      ', ',
    )}.`,
  );
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
): CurrentStoreProductType {
  const value = requireStringValue(constraint);

  if (value !== 'SHOES' && value !== 'CLOTHES' && value !== 'ACCESSORIES') {
    fail(`unsupported current-store product type ${value}.`);
  }

  return value;
}

/**
 * Нормализуем только семантические
 * варианты пола в native enum
 * текущего магазина.
 *
 * Это adapter concern.
 *
 * Product Consultant НЕ обязан знать,
 * что current store хранит:
 *
 * MAN / WOMAN / UNISEX.
 */
function normalizeGenderValue(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(
      /[_-]+/gu,

      ' ',
    )
    .replace(
      /\s+/gu,

      ' ',
    );
}

function requireGender(constraint: SearchConstraint): CurrentStoreGender {
  const original = requireStringValue(constraint);

  const value = normalizeGenderValue(original);

  const maleValues = new Set([
    'man',

    'male',

    'men',

    'mens',

    "men's",

    'мужской',

    'мужские',

    'мужская',

    'мужское',

    'мужчина',

    'мужчины',

    'для мужчин',
  ]);

  if (maleValues.has(value)) {
    return 'MAN';
  }

  const femaleValues = new Set([
    'woman',

    'female',

    'women',

    'womens',

    "women's",

    'женский',

    'женские',

    'женская',

    'женское',

    'женщина',

    'женщины',

    'для женщин',
  ]);

  if (femaleValues.has(value)) {
    return 'WOMAN';
  }

  const unisexValues = new Set(['unisex', 'унисекс']);

  if (unisexValues.has(value)) {
    return 'UNISEX';
  }

  fail(`unsupported current-store gender ${original}.`);
}

function currentStoreTypeForProfile(
  profileId: string | null,
): CurrentStoreProductType | null {
  switch (profileId) {
    case null:
    case 'GENERIC': {
      return null;
    }

    case 'SHOES': {
      return 'SHOES';
    }

    case 'CLOTHES': {
      return 'CLOTHES';
    }

    case 'ACCESSORIES': {
      return 'ACCESSORIES';
    }

    default: {
      fail(`unsupported current-store category profile ${profileId}.`);
    }
  }
}

/**
 * Consultation SearchSpec
 *                ↓
 * current-store ProductNeed
 *
 * Здесь живут именно store-specific
 * преобразования.
 */
export function compileCurrentStoreSearchSpec(
  searchRaw: SearchSpec,
): ProductNeed {
  const search = SearchSpecSchema.parse(searchRaw);

  const profileType = currentStoreTypeForProfile(search.category);

  const filters: ProductNeed['filters'] = {
    gender: null,

    /**
     * Consultation category/profile
     * deterministic задаёт
     * current-store Product.type.
     */
    type: profileType,

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
    assertCurrentStoreConstraintCapability(constraint);

    switch (constraint.attributeId) {
      case 'brand': {
        filters.brand = requireStringValue(constraint);

        break;
      }

      case 'category': {
        filters.category = requireStringValue(constraint);

        break;
      }

      case 'subcategory': {
        filters.subcategory = requireStringValue(constraint);

        break;
      }

      case 'type': {
        const requestedType = requireProductType(constraint);

        if (profileType !== null && requestedType !== profileType) {
          fail(
            `category profile ${search.category} maps to current-store type ${profileType}, but type:eq requests ${requestedType}.`,
          );
        }

        filters.type = requestedType;

        break;
      }

      case 'gender': {
        /**
         * Semantic value модели
         * переводится в native enum
         * магазина здесь.
         */
        filters.gender = requireGender(constraint);

        break;
      }

      case 'color': {
        filters.color = requireStringValue(constraint);

        break;
      }

      case 'sizes': {
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
        fail(
          `unsupported hard constraint ${constraintKey(
            constraint,
          )} for current store search.`,
        );
      }
    }
  }

  /**
   * Existing resolver пока
   * не гарантирует simultaneous
   * category + subcategory.
   */
  if (filters.category !== null && filters.subcategory !== null) {
    fail(
      'simultaneous category:eq and subcategory:eq are not executable by current store search.',
    );
  }

  if (exactPrice !== null) {
    filters.minPrice = exactPrice;

    filters.maxPrice = exactPrice;
  } else {
    filters.minPrice = minPrice;

    filters.maxPrice = maxPrice;
  }

  return ProductNeedSchema.parse({
    semanticQuery: search.semanticIntent,

    filters,
  });
}
