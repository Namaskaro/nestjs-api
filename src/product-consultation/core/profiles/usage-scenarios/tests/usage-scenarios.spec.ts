import { describe, expect, it } from '@jest/globals';

import { ACCESSORIES_PROFILE } from '../../accessories.profile';

import { CLOTHES_PROFILE } from '../../clothes.profile';

import { SHOES_PROFILE } from '../../shoes.profile';

import {
  ACCESSORIES_USAGE_SCENARIOS,
  CLOTHES_USAGE_SCENARIOS,
  SHOES_USAGE_SCENARIOS,
  defineCategoryUsageKnowledge,
  getCategoryUsageKnowledge,
} from '..';

describe('Category usage scenarios', () => {
  it('defines first-class usage knowledge for shoes', () => {
    expect(SHOES_USAGE_SCENARIOS.profileId).toBe('SHOES');

    expect(
      SHOES_USAGE_SCENARIOS.scenarios.map((scenario) => scenario.id),
    ).toEqual([
      'daily_walking',
      'long_walking_travel',
      'casual_city',
      'running',
      'training',
      'light_outdoor',
      'hot_weather',
      'wet_weather',
      'cold_weather',
    ]);
  });

  it('separates running from gym and fitness training', () => {
    const running = SHOES_USAGE_SCENARIOS.scenarios.find(
      (scenario) => scenario.id === 'running',
    );

    const training = SHOES_USAGE_SCENARIOS.scenarios.find(
      (scenario) => scenario.id === 'training',
    );

    expect(running).toBeDefined();
    expect(training).toBeDefined();

    expect(running?.signals).toContain('для бега');
    expect(training?.signals).not.toContain('для бега');
  });

  it('defines first-class usage knowledge for clothes', () => {
    expect(CLOTHES_USAGE_SCENARIOS.profileId).toBe('CLOTHES');

    expect(
      CLOTHES_USAGE_SCENARIOS.scenarios.map((scenario) => scenario.id),
    ).toEqual([
      'daily_wear',
      'office_work',
      'business_casual',
      'formal_event',
      'date_evening',
      'party_social',
      'travel',
      'active_day',
      'hot_weather',
      'rainy_weather',
      'cold_weather',
      'easy_care',
    ]);
  });

  it('defines first-class usage knowledge for accessories', () => {
    expect(ACCESSORIES_USAGE_SCENARIOS.profileId).toBe('ACCESSORIES');

    expect(
      ACCESSORIES_USAGE_SCENARIOS.scenarios.map((scenario) => scenario.id),
    ).toEqual([
      'tie_business_formal',
      'cufflinks_formal_event',
      'scarf_cold_weather',
      'scarf_style',
      'headwear_cold_weather',
      'headwear_sun_hot_weather',
      'headwear_casual_city',
      'bag_backpack_daily',
      'bag_backpack_work',
      'bag_backpack_travel',
      'eyewear_driving',
      'eyewear_sun_outdoor',
      'gloves_cold_weather',
      'belt_everyday',
      'belt_formal_business',
      'watch_everyday',
      'watch_formal',
      'watch_active',
      'gift',
    ]);
  });

  it('references only attributes known by every category profile', () => {
    const cases = [
      {
        profile: SHOES_PROFILE,
        knowledge: SHOES_USAGE_SCENARIOS,
      },
      {
        profile: CLOTHES_PROFILE,
        knowledge: CLOTHES_USAGE_SCENARIOS,
      },
      {
        profile: ACCESSORIES_PROFILE,
        knowledge: ACCESSORIES_USAGE_SCENARIOS,
      },
    ];

    for (const { profile, knowledge } of cases) {
      const knownAttributes = new Set(
        profile.attributes.map((attribute) => attribute.id),
      );

      for (const scenario of knowledge.scenarios) {
        for (const attributeId of scenario.attributeIds) {
          expect(knownAttributes.has(attributeId)).toBe(true);
        }
      }
    }
  });

  it('does not use weight as evidence for ordinary daily walking', () => {
    const dailyWalking = SHOES_USAGE_SCENARIOS.scenarios.find(
      (scenario) => scenario.id === 'daily_walking',
    );

    expect(dailyWalking).toBeDefined();

    expect(dailyWalking?.attributeIds).not.toContain('weight');
  });

  it('prioritizes confirmed construction and season for long walking and travel', () => {
    const longWalking = SHOES_USAGE_SCENARIOS.scenarios.find(
      (scenario) => scenario.id === 'long_walking_travel',
    );

    expect(longWalking).toBeDefined();

    expect(longWalking?.attributeIds).toEqual([
      'purpose',
      'sole',
      'upperMaterial',
      'material',
      'season',
    ]);
  });

  it('keeps accessory subcategory visible in every usage scenario', () => {
    for (const scenario of ACCESSORIES_USAGE_SCENARIOS.scenarios) {
      expect(scenario.attributeIds).toContain('subcategory');
    }
  });

  it('rejects usage scenario referencing unknown profile attribute', () => {
    expect(() =>
      defineCategoryUsageKnowledge(SHOES_PROFILE, {
        profileId: 'SHOES',
        version: 1,
        scenarios: [
          {
            id: 'invalid',
            title: 'Invalid scenario',
            description: 'Invalid scenario used only for validation test.',
            signals: ['test'],
            attributeIds: ['batteryCapacity'],
            instruction: 'Test instruction.',
            question: null,
          },
        ],
      }),
    ).toThrow('references unknown attribute batteryCapacity');
  });

  it('rejects duplicate scenario IDs', () => {
    expect(() =>
      defineCategoryUsageKnowledge(SHOES_PROFILE, {
        profileId: 'SHOES',
        version: 1,
        scenarios: [
          {
            id: 'daily_walking',
            title: 'First',
            description: 'First usage scenario.',
            signals: ['first'],
            attributeIds: ['purpose'],
            instruction: 'First instruction.',
            question: null,
          },
          {
            id: 'daily_walking',
            title: 'Second',
            description: 'Second usage scenario.',
            signals: ['second'],
            attributeIds: ['purpose'],
            instruction: 'Second instruction.',
            question: null,
          },
        ],
      }),
    ).toThrow('duplicate scenario IDs');
  });

  it('resolves category usage knowledge from registry', () => {
    expect(getCategoryUsageKnowledge('SHOES')).toBe(SHOES_USAGE_SCENARIOS);

    expect(getCategoryUsageKnowledge('CLOTHES')).toBe(CLOTHES_USAGE_SCENARIOS);

    expect(getCategoryUsageKnowledge('ACCESSORIES')).toBe(
      ACCESSORIES_USAGE_SCENARIOS,
    );

    expect(getCategoryUsageKnowledge('UNKNOWN')).toBeNull();
  });
});
