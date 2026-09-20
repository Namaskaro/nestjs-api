// START CHANGES — CURRENT STORE DECLARATIVE CATALOG MAPPING

import { normalizeSearchFilterValue } from '@/src/shared/utils/normalize-search-filter-value';

import { getCategoryProfile } from '@/src/product-consultation/core/profiles';
import {
  CanonicalRequirementSchema,
  type CanonicalRequirement,
} from '@/src/product-consultation/core/consultation-core.schema';
import type { ProductNeed } from '@/src/product-consultation/application/search/product-need.schema';

import { decodeDefault } from '../catalog/catalog-adapter';
import type {
  AttributeMapping,
  CatalogMapping,
  CatalogPath,
  UnitRegistry,
  ValueDecoder,
} from '../catalog/catalog-adapter.types';

export const CURRENT_STORE_SOURCE_ID = 'current-store:catalog';

export type StoreCatalogEntity = {
  id: string;

  name: string;
};

export type StoreProductRow = {
  id: string;

  title: string;

  description: string;

  price: string;

  discount: string | null;

  images: string[];

  sizes: string[];

  color: string | null;

  gender: string;

  type: string;

  inStock: boolean;

  stock: number;

  details: string[];

  updatedAt: Date;

  brand: StoreCatalogEntity | null;

  subcategory: {
    id: string;

    name: string;

    category: StoreCatalogEntity;
  } | null;
};

export type ResolvedStoreCatalog = {
  brandId: string | null;

  categoryId: string | null;

  subcategoryId: string | null;
};

export const CURRENT_STORE_UNITS: UnitRegistry = {
  kg: {
    kg: {
      factor: 1,
      offset: 0,
    },

    кг: {
      factor: 1,
      offset: 0,
    },

    g: {
      factor: 0.001,
      offset: 0,
    },

    gr: {
      factor: 0.001,
      offset: 0,
    },

    г: {
      factor: 0.001,
      offset: 0,
    },
  },

  L: {
    L: {
      factor: 1,
      offset: 0,
    },

    l: {
      factor: 1,
      offset: 0,
    },

    л: {
      factor: 1,
      offset: 0,
    },

    ml: {
      factor: 0.001,
      offset: 0,
    },

    мл: {
      factor: 0.001,
      offset: 0,
    },
  },

  mm: {
    mm: {
      factor: 1,
      offset: 0,
    },

    мм: {
      factor: 1,
      offset: 0,
    },

    cm: {
      factor: 10,
      offset: 0,
    },

    см: {
      factor: 10,
      offset: 0,
    },

    m: {
      factor: 1000,
      offset: 0,
    },

    м: {
      factor: 1000,
      offset: 0,
    },
  },
};

function normalizeDetailKey(value: string): string {
  return normalizeSearchFilterValue(value.normalize('NFKC')).replace(
    /\s+/g,
    ' ',
  );
}

const normalizeText: ValueDecoder = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeSearchFilterValue(value);

  if (!normalized) {
    return null;
  }

  return {
    value: normalized,

    transformations: ['normalize_search_filter_value'],
  };
};

function nonNegativeNumber(integer = false): ValueDecoder {
  return (value, context) => {
    const decoded = decodeDefault(value, context);

    if (
      !decoded ||
      typeof decoded.value !== 'number' ||
      decoded.value < 0 ||
      (integer && !Number.isSafeInteger(decoded.value))
    ) {
      return null;
    }

    return {
      ...decoded,

      transformations: [
        ...decoded.transformations,

        integer
          ? 'validate_nonnegative_integer'
          : 'validate_nonnegative_number',
      ],
    };
  };
}

const decodeNonNegativeNumber = nonNegativeNumber();

const decodeInteger = nonNegativeNumber(true);

const TRUE_VALUES = new Set(['да', 'true', 'yes', 'есть', 'имеется']);

const FALSE_VALUES = new Set(['нет', 'false', 'no', 'отсутствует']);

const detailDecoder: ValueDecoder = (value, context) => {
  if (context.attribute.kind === 'text') {
    return normalizeText(value, context);
  }

  if (context.attribute.kind === 'number') {
    /*
     * compartments — счётчик,
     * остальные current numeric details
     * должны быть >= 0.
     */
    return context.attribute.id === 'compartments'
      ? decodeInteger(value, context)
      : decodeNonNegativeNumber(value, context);
  }

  if (context.attribute.kind === 'boolean' && typeof value === 'string') {
    const normalized = normalizeSearchFilterValue(value);

    if (TRUE_VALUES.has(normalized)) {
      return {
        value: true,

        transformations: ['parse_explicit_boolean'],
      };
    }

    if (FALSE_VALUES.has(normalized)) {
      return {
        value: false,

        transformations: ['parse_explicit_boolean'],
      };
    }

    /*
     * Например UV400 мы не превращаем
     * автоматически в true.
     */
    return null;
  }

  return decodeDefault(value, context);
};

function field(
  path: CatalogPath,
  options: {
    displayPath?: CatalogPath;

    decode?: ValueDecoder;
  } = {},
): AttributeMapping<StoreProductRow> {
  return {
    sources: [
      {
        kind: 'path',

        path,

        displayPath: options.displayPath,
      },
    ],

    decode: options.decode,
  };
}

function detail(...aliases: string[]): AttributeMapping<StoreProductRow> {
  return {
    sources: [
      {
        kind: 'bag',

        bag: 'details',

        aliases,
      },
    ],

    decode: detailDecoder,
  };
}

/**
 * Здесь остаются только знания
 * КОНКРЕТНО текущего Store:
 *
 * - где лежит поле;
 * - как называется detail;
 * - какие единицы он использует;
 * - какое у него правило availability.
 *
 * Никакой consultation policy здесь нет.
 */
export const CURRENT_STORE_MAPPING: CatalogMapping<StoreProductRow> = {
  sourceId: CURRENT_STORE_SOURCE_ID,

  version: '3',

  units: CURRENT_STORE_UNITS,

  bags: {
    details: {
      kind: 'labels',

      path: ['details'],

      normalizeKey: normalizeDetailKey,
    },
  },

  readHeader: (row) => ({
    id: row.id,

    recordId: row.id,

    updatedAt: row.updatedAt.toISOString(),

    title: row.title,

    description: row.description,

    productType: row.type,

    /*
     * В отличие от raw row.type:
     * неизвестный тип не ломает adapter,
     * а получает GENERIC fallback.
     */
    profileId: getCategoryProfile(row.type).id,

    price: row.price,

    /*
     * В Product сейчас нет отдельного
     * подтверждённого currency field.
     */
    currency: null,

    discount: row.discount,

    images: row.images,

    brand: row.brand,

    category: row.subcategory?.category ?? null,

    subcategory: row.subcategory
      ? {
          id: row.subcategory.id,

          name: row.subcategory.name,
        }
      : null,
  }),

  attributes: {
    /*
     * Структурированные Product fields.
     */

    price: field(['price'], {
      decode: decodeNonNegativeNumber,
    }),

    brand: field(['brand', 'id'], {
      displayPath: ['brand', 'name'],
    }),

    category: field(['subcategory', 'category', 'id'], {
      displayPath: ['subcategory', 'category', 'name'],
    }),

    subcategory: field(['subcategory', 'id'], {
      displayPath: ['subcategory', 'name'],
    }),

    type: field(['type']),

    gender: field(['gender']),

    color: field(['color'], {
      decode: normalizeText,
    }),

    /*
     * Размеры оставляем в том же canonical виде,
     * в котором их использует текущий поиск.
     */
    sizes: field(['sizes']),

    inStock: field(['inStock']),

    stock: field(['stock'], {
      decode: decodeInteger,
    }),

    /*
     * Общие details.
     */

    material: detail('Материал', 'Основной материал'),

    composition: detail('Состав'),

    purpose: detail('Назначение', 'Предназначение'),

    season: detail('Сезон', 'Сезонность'),

    care: detail('Уход', 'Рекомендации по уходу'),

    waterProtection: detail('Водозащита', 'Влагозащита', 'Водонепроницаемость'),

    /*
     * Shoes.
     */

    upperMaterial: detail('Материал верха'),

    sole: detail('Подошва', 'Материал подошвы'),

    lining: detail('Подкладка', 'Материал подкладки'),

    weight: detail('Вес', 'Масса'),

    /*
     * Clothes.
     */

    fit: detail('Посадка', 'Крой', 'Силуэт'),

    pattern: detail('Рисунок', 'Принт', 'Узор'),

    garmentLength: detail('Длина изделия'),

    sleeveLength: detail('Длина рукава'),

    closure: detail('Застёжка', 'Застежка', 'Тип застёжки', 'Тип застежки'),

    stretch: detail('Эластичность', 'Эластичный материал'),

    insulation: detail('Утепление', 'Утеплитель'),

    /*
     * Bags / backpacks.
     */

    dimensions: detail('Габариты', 'Размер изделия'),

    capacity: detail('Объём', 'Объем', 'Вместимость'),

    compartments: detail('Количество отделений'),

    /*
     * Eyewear.
     */

    frameMaterial: detail('Материал оправы'),

    lensMaterial: detail('Материал линз'),

    lensColor: detail('Цвет линз'),

    uvProtection: detail('UV-защита', 'Защита от ультрафиолета', 'УФ-защита'),

    polarization: detail('Поляризация', 'Поляризационный фильтр'),

    /*
     * Watches.
     */

    movementType: detail('Тип механизма', 'Механизм'),

    strapMaterial: detail('Материал ремешка'),

    caseMaterial: detail('Материал корпуса'),

    caseDiameter: detail('Диаметр корпуса'),
  },

  availability: {
    inStockAttributeId: 'inStock',

    stockAttributeId: 'stock',
  },

  validateFacts: (facts) => {
    const inStock = facts.get('inStock');

    const stock = facts.get('stock');

    if (
      inStock?.status !== 'known' ||
      stock?.status !== 'known' ||
      typeof inStock.value !== 'boolean' ||
      typeof stock.value !== 'number'
    ) {
      return [
        {
          attributeIds: ['inStock'],

          status: 'unknown' as const,

          reason: 'availability_not_confirmed',
        },
      ];
    }

    /*
     * Это правило конкретно текущего Store.
     *
     * Другой Store может иметь:
     * preorder,
     * reserved stock,
     * external warehouse и т.д.
     */
    if (inStock.value !== stock.value > 0) {
      return [
        {
          attributeIds: ['inStock', 'stock'],

          status: 'conflicting' as const,

          reason: 'inStock_disagrees_with_stock',
        },
      ];
    }

    return [];
  },
};

// END CHANGES — CURRENT STORE DECLARATIVE CATALOG MAPPING

// START CHANGES — CURRENT STORE SEARCH → CONSULTATION BINDING

export function buildCurrentStoreBinding(
  filters: ProductNeed['filters'],
  resolvedCatalog: ResolvedStoreCatalog | null,
): {
  profileId: string;

  requirements: CanonicalRequirement[];
} {
  const requirements: CanonicalRequirement[] = [];

  function addRequirement(
    key: string,
    attributeId: string,
    operator: CanonicalRequirement['operator'],
    value: CanonicalRequirement['value'],
    label: string,
    resolution: CanonicalRequirement['resolution'] = 'resolved',
  ): void {
    requirements.push(
      CanonicalRequirementSchema.parse({
        requirementId: `filter:${key}`,

        attributeId,

        operator,

        value,

        unit: null,

        resolution,

        label,
      }),
    );
  }

  addRequirement(
    'inStock',
    'inStock',
    'eq',
    true,
    'Товар должен быть в наличии',
  );

  if (filters.brand) {
    const brandId = resolvedCatalog?.brandId ?? null;

    addRequirement(
      'brand',
      'brand',
      'eq',
      brandId,
      `Бренд: ${filters.brand}`,
      brandId ? 'resolved' : 'unresolved',
    );
  }

  if (filters.subcategory) {
    const subcategoryId = resolvedCatalog?.subcategoryId ?? null;

    addRequirement(
      'subcategory',
      'subcategory',
      'eq',
      subcategoryId,
      `Подкатегория: ${filters.subcategory}`,
      subcategoryId ? 'resolved' : 'unresolved',
    );
  } else if (filters.category) {
    const categoryId = resolvedCatalog?.categoryId ?? null;

    addRequirement(
      'category',
      'category',
      'eq',
      categoryId,
      `Категория: ${filters.category}`,
      categoryId ? 'resolved' : 'unresolved',
    );
  }

  if (filters.type) {
    addRequirement(
      'type',
      'type',
      'eq',
      filters.type,
      `Тип товара: ${filters.type}`,
    );
  }

  if (filters.gender) {
    addRequirement(
      'gender',
      'gender',
      'eq',
      filters.gender,
      `Каталожная маркировка: ${filters.gender}`,
    );
  }

  if (filters.color) {
    addRequirement(
      'color',
      'color',
      'eq',
      normalizeSearchFilterValue(filters.color),
      `Цвет: ${filters.color}`,
    );
  }

  if (filters.size) {
    addRequirement(
      'size',
      'sizes',
      'contains',
      filters.size,
      `Размер: ${filters.size}`,
    );
  }

  if (filters.minPrice !== null) {
    addRequirement(
      'minPrice',
      'price',
      'gte',
      filters.minPrice,
      `Цена не ниже ${filters.minPrice}`,
    );
  }

  if (filters.maxPrice !== null) {
    addRequirement(
      'maxPrice',
      'price',
      'lte',
      filters.maxPrice,
      `Цена не выше ${filters.maxPrice}`,
    );
  }

  return {
    profileId: getCategoryProfile(filters.type).id,

    requirements,
  };
}

// END CHANGES — CURRENT STORE SEARCH → CONSULTATION BINDING
