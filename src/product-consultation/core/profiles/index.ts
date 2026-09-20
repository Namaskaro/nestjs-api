// START CHANGES — CATEGORY PROFILE REGISTRY

import type { CategoryProfile } from '../consultation-core/consultation-core.schema';
import { ACCESSORIES_PROFILE } from './accessories.profile';

import { CLOTHES_PROFILE } from './clothes.profile';
import { GENERIC_PROFILE } from './generic.profile';
import { SHOES_PROFILE } from './shoes.profile';

export { ACCESSORIES_PROFILE, CLOTHES_PROFILE, GENERIC_PROFILE, SHOES_PROFILE };

export const CATEGORY_PROFILES: CategoryProfile[] = [
  GENERIC_PROFILE,
  SHOES_PROFILE,
  CLOTHES_PROFILE,
  ACCESSORIES_PROFILE,
];

const CATEGORY_PROFILE_REGISTRY = new Map(
  CATEGORY_PROFILES.map((profile) => [profile.id, profile] as const),
);

export function getCategoryProfile(
  profileId: string | null | undefined,
): CategoryProfile {
  if (!profileId) {
    return GENERIC_PROFILE;
  }

  return CATEGORY_PROFILE_REGISTRY.get(profileId) ?? GENERIC_PROFILE;
}

// END CHANGES — CATEGORY PROFILE REGISTRY
