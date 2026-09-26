import { describe, expect, it } from '@jest/globals';

import type { ProductNeed } from '@/src/product-consultation/application/search/product-need.schema';
import { ConsultationCore } from '@/src/product-consultation/core/consultation-core';
import { emptyConsultationMemory } from '@/src/product-consultation/core/consultation-core.schema';
import { CATEGORY_PROFILES } from '@/src/product-consultation/core/profiles';

import { toProductDetails } from '../current-store-product.adapter';
import {
  buildCurrentStoreBinding,
  CURRENT_STORE_MAPPING,
  type StoreProductRow,
} from '../current-store.mapping';

const OBSERVED_AT = '2026-09-24T12:00:00.000Z';

const SEARCH_FILTERS: ProductNeed['filters'] = {
  gender: 'MAN',

  type: 'SHOES',

  brand: 'Nike',

  category: null,

  subcategory: null,

  color: 'green',

  size: '42',

  minPrice: null,

  maxPrice: 20_000,
};

function createStoreProductRow(
  overrides: Partial<StoreProductRow> = {},
): StoreProductRow {
  return {
    id: 'product-1',

    title: 'Nike Test Shoes',

    description: 'Test shoes',

    price: '15000',

    discount: '0',

    images: ['https://example.com/product.jpg'],

    sizes: ['41', '42', '43'],

    color: 'green',

    gender: 'MAN',

    type: 'SHOES',

    inStock: true,

    stock: 5,

    details: ['Материал верха: кожа', 'Подошва: резина'],

    updatedAt: new Date('2026-09-24T10:00:00.000Z'),

    brand: {
      id: 'brand-nike',

      name: 'Nike',
    },

    subcategory: {
      id: 'subcategory-sneakers',

      name: 'Кроссовки',

      category: {
        id: 'category-shoes',

        name: 'Обувь',
      },
    },

    ...overrides,
  };
}

describe('Current store availability ownership', () => {
  it('keeps availability outside consultation attribute mapping', () => {
    const attributeIds = Object.keys(CURRENT_STORE_MAPPING.attributes);

    expect(attributeIds).not.toContain('inStock');

    expect(attributeIds).not.toContain('stock');

    expect(CURRENT_STORE_MAPPING).not.toHaveProperty('availability');
  });

  it('does not create availability requirements in legacy consultation binding', () => {
    const binding = buildCurrentStoreBinding(SEARCH_FILTERS, {
      brandId: 'brand-nike',

      categoryId: null,

      subcategoryId: null,
    });

    expect(
      binding.requirements.map((requirement) => requirement.attributeId),
    ).not.toContain('inStock');

    expect(
      binding.requirements.map((requirement) => requirement.attributeId),
    ).not.toContain('stock');

    expect(
      binding.requirements.map((requirement) => requirement.requirementId),
    ).not.toContain('filter:inStock');
  });

  it('keeps confirmed availability in the canonical product envelope only', () => {
    const product = toProductDetails(createStoreProductRow(), OBSERVED_AT);

    expect(product.availability).toEqual({
      inStock: true,

      stock: 5,
    });

    expect(product.attributes.map((fact) => fact.attributeId)).not.toContain(
      'inStock',
    );

    expect(product.attributes.map((fact) => fact.attributeId)).not.toContain(
      'stock',
    );
  });

  it('does not expose inconsistent availability as confirmed data', () => {
    const product = toProductDetails(
      createStoreProductRow({
        inStock: true,

        stock: 0,
      }),
      OBSERVED_AT,
    );

    expect(product.availability).toEqual({
      inStock: null,

      stock: null,
    });
  });

  it('can build legacy ConsultationCore without an availability requirement', () => {
    const product = toProductDetails(createStoreProductRow(), OBSERVED_AT);

    const binding = buildCurrentStoreBinding(SEARCH_FILTERS, {
      brandId: 'brand-nike',

      categoryId: null,

      subcategoryId: null,
    });

    expect(
      () =>
        new ConsultationCore({
          needs: [
            {
              needId: 'need-1',

              query: 'мужские зелёные кроссовки Nike 42 размера',

              preferences: [],

              profileId: binding.profileId,

              memory: emptyConsultationMemory(),

              requirements: binding.requirements,

              allowedProductIds: [product.id],

              displayedProductIds: [product.id],

              comparisonProductIds: [],
            },
          ],

          products: [product],

          profiles: CATEGORY_PROFILES,
        }),
    ).not.toThrow();
  });
});
