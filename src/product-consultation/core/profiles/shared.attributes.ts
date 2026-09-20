// START CHANGES — SHARED CANONICAL PRODUCT ATTRIBUTES

import {
  AttributeDefinitionSchema,
  type AttributeDefinition,
} from '@/src/product-consultation/core/consultation-core.schema';

type AttributeOptions = {
  kind?: 'text' | 'number' | 'boolean' | 'set';

  unit?: string | null;

  allowedOperators?: Array<'observe' | 'eq' | 'contains' | 'lte' | 'gte'>;

  comparison?: 'exact' | 'numeric' | 'set' | 'none';
};

export function defineAttribute(
  id: string,
  label: string,
  options: AttributeOptions = {},
): AttributeDefinition {
  const kind = options.kind ?? 'text';

  const defaultOperators = {
    text: ['observe', 'eq'],
    number: ['observe', 'eq', 'lte', 'gte'],
    boolean: ['observe', 'eq'],
    set: ['observe', 'contains'],
  } as const;

  const defaultComparison = {
    text: 'exact',
    number: 'numeric',
    boolean: 'exact',
    set: 'set',
  } as const;

  return AttributeDefinitionSchema.parse({
    id,

    label,

    kind,

    unit: options.unit ?? null,

    allowedOperators: options.allowedOperators ?? [...defaultOperators[kind]],

    comparison: options.comparison ?? defaultComparison[kind],
  });
}

export const priceAttribute = defineAttribute('price', 'Цена', {
  kind: 'number',
});

export const brandAttribute = defineAttribute('brand', 'Бренд');

export const categoryAttribute = defineAttribute('category', 'Категория');

export const subcategoryAttribute = defineAttribute(
  'subcategory',
  'Подкатегория',
);

export const typeAttribute = defineAttribute('type', 'Тип товара');

export const genderAttribute = defineAttribute('gender', 'Маркировка пола');

export const colorAttribute = defineAttribute('color', 'Цвет');

export const sizesAttribute = defineAttribute('sizes', 'Доступные размеры', {
  kind: 'set',
});

export const inStockAttribute = defineAttribute('inStock', 'В наличии', {
  kind: 'boolean',
});

export const stockAttribute = defineAttribute('stock', 'Общий остаток', {
  kind: 'number',
});

export const materialAttribute = defineAttribute(
  'material',
  'Основной материал',
);

export const compositionAttribute = defineAttribute('composition', 'Состав');

export const upperMaterialAttribute = defineAttribute(
  'upperMaterial',
  'Материал верха',
);

export const seasonAttribute = defineAttribute('season', 'Сезон');

export const purposeAttribute = defineAttribute(
  'purpose',
  'Заявленное назначение',
);

export const soleAttribute = defineAttribute('sole', 'Подошва');

export const liningAttribute = defineAttribute('lining', 'Подкладка');

export const weightAttribute = defineAttribute('weight', 'Указанный вес', {
  kind: 'number',

  unit: 'kg',
});

export const waterProtectionAttribute = defineAttribute(
  'waterProtection',
  'Водозащита',
);

export const fitAttribute = defineAttribute('fit', 'Посадка / крой');

export const careAttribute = defineAttribute('care', 'Уход');

export const dimensionsAttribute = defineAttribute('dimensions', 'Габариты');

export const capacityAttribute = defineAttribute('capacity', 'Объём', {
  kind: 'number',

  unit: 'L',
});

export const compatibilityAttribute = defineAttribute(
  'compatibility',
  'Совместимость',
  {
    kind: 'set',
  },
);

export const GENERIC_ATTRIBUTES: AttributeDefinition[] = [
  priceAttribute,

  brandAttribute,

  categoryAttribute,

  subcategoryAttribute,

  typeAttribute,

  inStockAttribute,

  stockAttribute,
];
