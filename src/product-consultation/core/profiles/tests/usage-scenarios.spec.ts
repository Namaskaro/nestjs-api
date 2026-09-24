import { describe, expect, it } from '@jest/globals';

import { SHOES_PROFILE } from '../shoes.profile';

import {
  CLOTHES_USAGE_SCENARIOS,
  SHOES_USAGE_SCENARIOS,
  defineCategoryUsageKnowledge,
  getCategoryUsageKnowledge,
} from '../usage-scenarios';

describe('Category usage scenarios', () => {
  it('defines first-class usage knowledge for shoes', () => {
    expect(SHOES_USAGE_SCENARIOS.profileId).toBe('SHOES');

    expect(
      SHOES_USAGE_SCENARIOS.scenarios.map((scenario) => scenario.id),
    ).toEqual(['daily_walking', 'training', 'wet_weather', 'cold_weather']);
  });

  it('defines first-class usage knowledge for clothes', () => {
    expect(CLOTHES_USAGE_SCENARIOS.profileId).toBe('CLOTHES');

    expect(
      CLOTHES_USAGE_SCENARIOS.scenarios.map((scenario) => scenario.id),
    ).toEqual(['daily_wear', 'office_work', 'formal_event', 'cold_weather']);
  });

  it('references only attributes known by the category profile', () => {
    const knownShoesAttributes = new Set(
      SHOES_PROFILE.attributes.map((attribute) => attribute.id),
    );

    for (const scenario of SHOES_USAGE_SCENARIOS.scenarios) {
      for (const attributeId of scenario.attributeIds) {
        expect(knownShoesAttributes.has(attributeId)).toBe(true);
      }
    }
  });

  it('does not use weight as evidence for daily walking', () => {
    const dailyWalking = SHOES_USAGE_SCENARIOS.scenarios.find(
      (scenario) => scenario.id === 'daily_walking',
    );

    expect(dailyWalking).toBeDefined();

    expect(dailyWalking?.attributeIds).not.toContain('weight');
  });

  it('rejects usage scenario referencing unknown profile attribute', () => {
    expect(() =>
      defineCategoryUsageKnowledge(
        SHOES_PROFILE,

        {
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
        },
      ),
    ).toThrow('references unknown attribute batteryCapacity');
  });

  it('rejects duplicate scenario IDs', () => {
    expect(() =>
      defineCategoryUsageKnowledge(
        SHOES_PROFILE,

        {
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
        },
      ),
    ).toThrow('duplicate scenario IDs');
  });

  it('resolves category usage knowledge from registry', () => {
    expect(getCategoryUsageKnowledge('SHOES')).toBe(SHOES_USAGE_SCENARIOS);

    expect(getCategoryUsageKnowledge('CLOTHES')).toBe(CLOTHES_USAGE_SCENARIOS);

    expect(getCategoryUsageKnowledge('UNKNOWN')).toBeNull();
  });
});
