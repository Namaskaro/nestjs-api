import { describe, expect, it } from '@jest/globals';

import { CURRENT_STORE_SEARCH_CAPABILITIES } from '../../../adapters/current-store/current-store-search-spec';

import { createProductConsultationState } from '../../../core/state/consultation-state';

import {
  ConsultationApplicationRecordSchema,
  createConsultationApplicationRecord,
} from '../../runtime/consultation-application-record';

import { buildProductConsultationContext } from '../product-consultation-context';

function shoesRecord() {
  const base = createConsultationApplicationRecord();

  return ConsultationApplicationRecordSchema.parse({
    ...base,

    revision: 1,

    generation: 1,

    state: createProductConsultationState({
      semanticIntent: 'мужские кроссовки',

      category: 'SHOES',

      constraints: [],
    }),
  });
}

describe('ProductConsultationContext search capabilities', () => {
  it('projects store capabilities through CategoryProfile intersection', () => {
    const built = buildProductConsultationContext({
      record: shoesRecord(),

      currentMessage: 'Нужны мужские кроссовки Nike 43 размера',

      searchCapabilities: CURRENT_STORE_SEARCH_CAPABILITIES,
    });

    expect(
      built.context.searchCapabilities?.profiles.map(
        (profile) => profile.profileId,
      ),
    ).toEqual(['SHOES', 'CLOTHES', 'ACCESSORIES']);

    const shoes = built.context.searchCapabilities?.profiles.find(
      (profile) => profile.profileId === 'SHOES',
    );

    expect(shoes).toBeDefined();

    expect(shoes?.attributes).toEqual(
      expect.arrayContaining([
        {
          attributeId: 'brand',

          kind: 'text',

          unit: null,

          operators: ['eq'],
        },

        {
          attributeId: 'gender',

          kind: 'text',

          unit: null,

          operators: ['eq'],
        },

        {
          attributeId: 'sizes',

          kind: 'set',

          unit: null,

          operators: ['contains'],
        },

        {
          attributeId: 'price',

          kind: 'number',

          unit: null,

          operators: ['eq', 'gte', 'lte'],
        },
      ]),
    );
  });

  it('does not expose redundant type constraint to Product Consultant', () => {
    const built = buildProductConsultationContext({
      record: shoesRecord(),

      currentMessage: 'Найди обувь',

      searchCapabilities: CURRENT_STORE_SEARCH_CAPABILITIES,
    });

    for (const profile of built.context.searchCapabilities?.profiles ?? []) {
      expect(
        profile.attributes.some(
          (attribute) => attribute.attributeId === 'type',
        ),
      ).toBe(false);
    }
  });

  it('does not advertise semantic profile attributes that current store cannot execute as hard search constraints', () => {
    const built = buildProductConsultationContext({
      record: shoesRecord(),

      currentMessage: 'Нужны для дождя',

      searchCapabilities: CURRENT_STORE_SEARCH_CAPABILITIES,
    });

    const shoes = built.context.searchCapabilities?.profiles.find(
      (profile) => profile.profileId === 'SHOES',
    );

    /**
     * waterProtection существует
     * в SHOES_PROFILE и полезен
     * для reasoning/facts,
     *
     * но current store пока
     * не умеет гарантировать его
     * как hard search filter.
     */
    expect(
      shoes?.attributes.some(
        (attribute) => attribute.attributeId === 'waterProtection',
      ),
    ).toBe(false);
  });

  it('keeps store implementation details outside LLM capabilities', () => {
    const built = buildProductConsultationContext({
      record: shoesRecord(),

      currentMessage: 'Подбери варианты',

      searchCapabilities: CURRENT_STORE_SEARCH_CAPABILITIES,
    });

    const serialized = JSON.stringify(built.context.searchCapabilities);

    expect(serialized).not.toContain('Qdrant');

    expect(serialized).not.toContain('Prisma');

    expect(serialized).not.toContain('ProductNeed');

    expect(serialized).not.toContain('brandId');

    expect(serialized).not.toContain('categoryId');

    expect(serialized).not.toContain('subcategoryId');
  });
});
