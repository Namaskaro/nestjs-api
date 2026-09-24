import { describe, expect, it } from '@jest/globals';

import { assertSearchSpecMatchesCategoryProfile } from '../../search/search-spec-profile';

import { GENERIC_PROFILE } from '../generic.profile';

import { SHOES_PROFILE } from '../shoes.profile';

import { GENERIC_ATTRIBUTES } from '../shared.attributes';

describe('Product Consultation availability ownership', () => {
  it('does not expose inStock or stock through generic consultation attributes', () => {
    const attributeIds = GENERIC_ATTRIBUTES.map((attribute) => attribute.id);

    expect(attributeIds).not.toContain('inStock');

    expect(attributeIds).not.toContain('stock');
  });

  it('does not expose inStock or stock through GENERIC_PROFILE', () => {
    const attributeIds = GENERIC_PROFILE.attributes.map(
      (attribute) => attribute.id,
    );

    expect(attributeIds).not.toContain('inStock');

    expect(attributeIds).not.toContain('stock');
  });

  it('does not reference availability inside GENERIC_PROFILE criteria', () => {
    expect(GENERIC_PROFILE.defaultCriteria).not.toContain('inStock');

    expect(GENERIC_PROFILE.defaultCriteria).not.toContain('stock');

    expect(GENERIC_PROFILE.criticalAttributes).not.toContain('inStock');

    expect(GENERIC_PROFILE.criticalAttributes).not.toContain('stock');
  });

  it('does not reference availability inside GENERIC_PROFILE guidance', () => {
    const guidanceAttributeIds = GENERIC_PROFILE.guidance.flatMap(
      (guidance) => guidance.attributeIds,
    );

    expect(guidanceAttributeIds).not.toContain('inStock');

    expect(guidanceAttributeIds).not.toContain('stock');
  });

  it('does not expose inStock or stock through SHOES_PROFILE', () => {
    const attributeIds = SHOES_PROFILE.attributes.map(
      (attribute) => attribute.id,
    );

    expect(attributeIds).not.toContain('inStock');

    expect(attributeIds).not.toContain('stock');
  });

  it('still exposes normal generic searchable attributes', () => {
    const attributeIds = GENERIC_ATTRIBUTES.map((attribute) => attribute.id);

    expect(attributeIds).toEqual(
      expect.arrayContaining([
        'price',

        'brand',

        'category',

        'subcategory',

        'type',
      ]),
    );
  });

  it('rejects inStock as a SearchSpec constraint', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'мужские кроссовки',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'inStock',

              operator: 'eq',

              value: true,

              unit: null,
            },
          ],
        },

        SHOES_PROFILE,
      ),
    ).toThrow('unknown attribute inStock');
  });

  it('rejects stock quantity as a SearchSpec constraint', () => {
    expect(() =>
      assertSearchSpecMatchesCategoryProfile(
        {
          semanticIntent: 'мужские кроссовки',

          category: 'SHOES',

          constraints: [
            {
              attributeId: 'stock',

              operator: 'gte',

              value: 5,

              unit: null,
            },
          ],
        },

        SHOES_PROFILE,
      ),
    ).toThrow('unknown attribute stock');
  });
});
