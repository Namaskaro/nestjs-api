import { describe, expect, it } from '@jest/globals';

import {
  applySearchSpecPatch,
  createSearchSpec,
  findSearchConstraint,
} from './search-spec';

function initialNikeSearch() {
  return createSearchSpec({
    semanticIntent: 'мужские кроссовки',

    category: 'SHOES',

    constraints: [
      {
        attributeId: 'gender',

        operator: 'eq',

        value: 'MAN',

        unit: null,
      },

      {
        attributeId: 'brand',

        operator: 'eq',

        value: 'Nike',

        unit: null,
      },
    ],
  });
}

describe('SearchSpec', () => {
  it('creates canonical search state', () => {
    const spec = initialNikeSearch();

    expect(spec).toEqual({
      version: 1,

      semanticIntent: 'мужские кроссовки',

      category: 'SHOES',

      constraints: [
        {
          attributeId: 'gender',

          operator: 'eq',

          value: 'MAN',

          unit: null,
        },

        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Nike',

          unit: null,
        },
      ],
    });
  });

  it('adds a new constraint without losing existing constraints', () => {
    const current = initialNikeSearch();

    const next = applySearchSpecPatch(current, {
      set: [
        {
          attributeId: 'color',

          operator: 'eq',

          value: 'зелёный',

          unit: null,
        },
      ],

      clear: [],
    });

    expect(
      findSearchConstraint(next, {
        attributeId: 'gender',

        operator: 'eq',
      })?.value,
    ).toBe('MAN');

    expect(
      findSearchConstraint(next, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Nike');

    expect(
      findSearchConstraint(next, {
        attributeId: 'color',

        operator: 'eq',
      })?.value,
    ).toBe('зелёный');
  });

  it('replaces Nike with Adidas while preserving gender and color', () => {
    const withColor = applySearchSpecPatch(initialNikeSearch(), {
      set: [
        {
          attributeId: 'color',

          operator: 'eq',

          value: 'зелёный',

          unit: null,
        },
      ],

      clear: [],
    });

    const adidas = applySearchSpecPatch(withColor, {
      set: [
        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Adidas',

          unit: null,
        },
      ],

      clear: [],
    });

    expect(
      findSearchConstraint(adidas, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Adidas');

    expect(
      findSearchConstraint(adidas, {
        attributeId: 'gender',

        operator: 'eq',
      })?.value,
    ).toBe('MAN');

    expect(
      findSearchConstraint(adidas, {
        attributeId: 'color',

        operator: 'eq',
      })?.value,
    ).toBe('зелёный');

    expect(adidas.semanticIntent).toBe('мужские кроссовки');
  });

  it('clears only explicitly removed constraint', () => {
    const adidasGreen = applySearchSpecPatch(initialNikeSearch(), {
      set: [
        {
          attributeId: 'brand',

          operator: 'eq',

          value: 'Adidas',

          unit: null,
        },

        {
          attributeId: 'color',

          operator: 'eq',

          value: 'зелёный',

          unit: null,
        },
      ],

      clear: [],
    });

    const withoutColor = applySearchSpecPatch(adidasGreen, {
      set: [],

      clear: [
        {
          attributeId: 'color',

          operator: 'eq',
        },
      ],
    });

    expect(
      findSearchConstraint(withoutColor, {
        attributeId: 'color',

        operator: 'eq',
      }),
    ).toBeNull();

    expect(
      findSearchConstraint(withoutColor, {
        attributeId: 'brand',

        operator: 'eq',
      })?.value,
    ).toBe('Adidas');

    expect(
      findSearchConstraint(withoutColor, {
        attributeId: 'gender',

        operator: 'eq',
      })?.value,
    ).toBe('MAN');
  });

  it('supports independent price lower and upper constraints', () => {
    const current = initialNikeSearch();

    const next = applySearchSpecPatch(current, {
      set: [
        {
          attributeId: 'price',

          operator: 'gte',

          value: 10000,

          unit: 'RUB',
        },

        {
          attributeId: 'price',

          operator: 'lte',

          value: 20000,

          unit: 'RUB',
        },
      ],

      clear: [],
    });

    expect(
      findSearchConstraint(next, {
        attributeId: 'price',

        operator: 'gte',
      })?.value,
    ).toBe(10000);

    expect(
      findSearchConstraint(next, {
        attributeId: 'price',

        operator: 'lte',
      })?.value,
    ).toBe(20000);
  });

  it('can clear one side of a price range without touching the other', () => {
    const withRange = applySearchSpecPatch(initialNikeSearch(), {
      set: [
        {
          attributeId: 'price',

          operator: 'gte',

          value: 10000,

          unit: 'RUB',
        },

        {
          attributeId: 'price',

          operator: 'lte',

          value: 20000,

          unit: 'RUB',
        },
      ],

      clear: [],
    });

    const next = applySearchSpecPatch(withRange, {
      set: [],

      clear: [
        {
          attributeId: 'price',

          operator: 'lte',
        },
      ],
    });

    expect(
      findSearchConstraint(next, {
        attributeId: 'price',

        operator: 'gte',
      })?.value,
    ).toBe(10000);

    expect(
      findSearchConstraint(next, {
        attributeId: 'price',

        operator: 'lte',
      }),
    ).toBeNull();
  });
});
