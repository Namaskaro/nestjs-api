import type { CategoryUsageKnowledge } from './category-usage-scenario.schema';

import { CLOTHES_USAGE_SCENARIOS } from './clothes.usage-scenarios';

import { SHOES_USAGE_SCENARIOS } from './shoes.usage-scenarios';

export {
  CategoryUsageKnowledgeSchema,
  CategoryUsageScenarioSchema,
  UsageScenarioQuestionSchema,
  defineCategoryUsageKnowledge,
} from './category-usage-scenario.schema';

export type {
  CategoryUsageKnowledge,
  CategoryUsageScenario,
} from './category-usage-scenario.schema';

export { CLOTHES_USAGE_SCENARIOS, SHOES_USAGE_SCENARIOS };

export const CATEGORY_USAGE_KNOWLEDGE: CategoryUsageKnowledge[] = [
  SHOES_USAGE_SCENARIOS,

  CLOTHES_USAGE_SCENARIOS,
];

const CATEGORY_USAGE_KNOWLEDGE_REGISTRY = new Map(
  CATEGORY_USAGE_KNOWLEDGE.map(
    (knowledge) => [knowledge.profileId, knowledge] as const,
  ),
);

/**
 * Возвращает usage knowledge
 * конкретной категории.
 *
 * Отсутствие записи означает:
 *
 * "для категории ещё не определены
 * специализированные usage scenarios".
 *
 * Это не ошибка.
 */
export function getCategoryUsageKnowledge(
  profileId: string | null | undefined,
): CategoryUsageKnowledge | null {
  if (!profileId) {
    return null;
  }

  return CATEGORY_USAGE_KNOWLEDGE_REGISTRY.get(profileId) ?? null;
}
