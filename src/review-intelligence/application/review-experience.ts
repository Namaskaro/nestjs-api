import { reviewStats, type ReviewExperience } from '../core/review-model';
import type { ReviewExperiencePort } from './ports';

export async function readReviewExperience(
  source: ReviewExperiencePort,
  productIds: readonly string[],
): Promise<Map<string, ReviewExperience>> {
  const ids = [...new Set(productIds)];
  const { groups, summaries } = await source.experienceSnapshot(ids);
  const byProduct = new Map(
    summaries.map((summary) => [summary.productId, summary]),
  );
  return new Map(
    [...reviewStats(ids, groups)].map(([id, stats]) => [
      id,
      { ...stats, summary: byProduct.get(id) ?? null },
    ]),
  );
}
