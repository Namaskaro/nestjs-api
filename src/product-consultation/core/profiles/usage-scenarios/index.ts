import type { CategoryUsageKnowledge } from './category-usage-scenario.schema';

import { ACCESSORIES_USAGE_SCENARIOS } from './accessories.usage-scenarios';

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

export {
  ACCESSORIES_USAGE_SCENARIOS,
  CLOTHES_USAGE_SCENARIOS,
  SHOES_USAGE_SCENARIOS,
};

export const MAX_SELECTED_USAGE_SCENARIOS = 3;

export const CATEGORY_USAGE_KNOWLEDGE: CategoryUsageKnowledge[] = [
  SHOES_USAGE_SCENARIOS,

  CLOTHES_USAGE_SCENARIOS,

  ACCESSORIES_USAGE_SCENARIOS,
];

const CATEGORY_USAGE_KNOWLEDGE_REGISTRY = new Map(
  CATEGORY_USAGE_KNOWLEDGE.map(
    (knowledge) => [knowledge.profileId, knowledge] as const,
  ),
);

export type UsageScenarioSelectionDiagnostic = {
  code: 'unknown_usage_scenario';

  scenarioId: string;

  profileId: string | null;
};

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

/**
 * Единая deterministic boundary
 * выбора Usage Scenario.
 *
 * ВАЖНО:
 *
 * structural ошибки остаются ошибками:
 *
 * - пустой ID;
 * - duplicate;
 * - больше допустимого количества.
 *
 * Но неизвестный semantic ID
 * является optional enrichment error.
 *
 * Поэтому:
 *
 * unknown scenario
 * → отбрасывается;
 * → возвращается diagnostic;
 * → основной пользовательский request
 *   продолжает выполняться.
 *
 * Usage Scenario не владеет:
 *
 * - SearchSpec;
 * - State;
 * - Memory;
 * - Results.
 *
 * Поэтому неизвестный scenario
 * не имеет права ломать корректный
 * SEARCH / DETAILS / COMPARE /
 * RECOMMEND.
 */
export function resolveCategoryUsageScenarioSelection(
  profileId: string | null | undefined,

  rawScenarioIds: readonly string[],
) {
  const normalizedProfileId = profileId?.trim() || null;

  const scenarioIds = rawScenarioIds.map((scenarioId) => scenarioId.trim());

  if (scenarioIds.some((scenarioId) => !scenarioId)) {
    throw new Error('Usage scenario ID must not be empty.');
  }

  if (scenarioIds.length > MAX_SELECTED_USAGE_SCENARIOS) {
    throw new Error(
      `At most ${MAX_SELECTED_USAGE_SCENARIOS} usage scenarios may be selected.`,
    );
  }

  if (new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error('Duplicate usage scenario ID.');
  }

  const knowledge = getCategoryUsageKnowledge(normalizedProfileId);

  if (knowledge === null) {
    return {
      knowledge: null,

      selected: [],

      selectedIds: [],

      diagnostics: scenarioIds.map(
        (scenarioId): UsageScenarioSelectionDiagnostic => ({
          code: 'unknown_usage_scenario',

          scenarioId,

          profileId: normalizedProfileId,
        }),
      ),
    };
  }

  const scenarioById = new Map(
    knowledge.scenarios.map((scenario) => [scenario.id, scenario] as const),
  );

  const selected = [];

  const diagnostics: UsageScenarioSelectionDiagnostic[] = [];

  for (const scenarioId of scenarioIds) {
    const scenario = scenarioById.get(scenarioId);

    if (!scenario) {
      diagnostics.push({
        code: 'unknown_usage_scenario',

        scenarioId,

        profileId: knowledge.profileId,
      });

      continue;
    }

    selected.push(scenario);
  }

  return {
    knowledge,

    selected,

    selectedIds: selected.map((scenario) => scenario.id),

    diagnostics,
  };
}
