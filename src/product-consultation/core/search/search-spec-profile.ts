import { CategoryProfileSchema } from '../consultation-core.schema';

import {
  assertCategoryProfileAttributeCondition,
  assertCategoryProfileAttributeSelector,
  requireCategoryProfileAttribute,
} from '../profiles/category-profile-attribute-validation';

import {
  SearchSpecDraftSchema,
  SearchSpecPatchSchema,
  SearchSpecSchema,
  type SearchConstraint,
} from './search-spec.schema';

function fail(message: string): never {
  throw new Error(`SearchSpecProfile: ${message}`);
}

/**
 * Zod runtime schema требует value,
 * но inferred type SearchConstraint
 * в текущей композиции schema может
 * представлять его как optional.
 *
 * На этой boundary превращаем
 * parsed SearchConstraint в строгий
 * CategoryProfileAttributeCondition.
 *
 * Общий profile validator при этом
 * остаётся строгим и НЕ принимает
 * condition без value.
 */
function assertSearchConstraint(
  profile: ReturnType<typeof CategoryProfileSchema.parse>,

  constraint: SearchConstraint,
): void {
  if (constraint.value === undefined) {
    fail(
      `constraint ${constraint.attributeId}:${constraint.operator} requires value.`,
    );
  }

  assertCategoryProfileAttributeCondition(
    {
      attributeId: constraint.attributeId,

      operator: constraint.operator,

      value: constraint.value,

      unit: constraint.unit ?? null,
    },

    profile,
  );
}

type NumericConstraintSet = {
  eq?: number;

  lte?: number;

  gte?: number;
};

/**
 * Проверяет совместный смысл numeric constraints.
 *
 * Каждое ограничение по отдельности может
 * быть совершенно валидным:
 *
 * price >= 20_000
 * price <= 15_000
 *
 * Но вместе они описывают невозможный диапазон.
 *
 * Проверяем:
 *
 * - gte <= lte;
 * - eq >= gte;
 * - eq <= lte.
 *
 * Равные границы разрешены:
 *
 * gte 15_000
 * lte 15_000
 *
 * означает точную точку 15_000.
 */
function assertNumericConstraintCompatibility(
  profile: ReturnType<typeof CategoryProfileSchema.parse>,

  constraints: readonly SearchConstraint[],
): void {
  const grouped = new Map<string, NumericConstraintSet>();

  for (const constraint of constraints) {
    const attribute = requireCategoryProfileAttribute(
      profile,

      constraint.attributeId,
    );

    if (attribute.kind !== 'number') {
      continue;
    }

    if (
      constraint.operator !== 'eq' &&
      constraint.operator !== 'lte' &&
      constraint.operator !== 'gte'
    ) {
      continue;
    }

    if (typeof constraint.value !== 'number') {
      /**
       * Тип уже проверяется общей
       * attribute semantic validation.
       *
       * Сюда не должны попадать
       * невалидные numeric values.
       */
      continue;
    }

    const current = grouped.get(constraint.attributeId) ?? {};

    current[constraint.operator] = constraint.value;

    grouped.set(constraint.attributeId, current);
  }

  for (const [attributeId, numeric] of grouped) {
    if (
      numeric.gte !== undefined &&
      numeric.lte !== undefined &&
      numeric.gte > numeric.lte
    ) {
      fail(
        `numeric constraints for attribute ${attributeId} are contradictory: ` +
          `gte ${numeric.gte} exceeds lte ${numeric.lte}.`,
      );
    }

    if (
      numeric.eq !== undefined &&
      numeric.gte !== undefined &&
      numeric.eq < numeric.gte
    ) {
      fail(
        `numeric constraints for attribute ${attributeId} are contradictory: ` +
          `eq ${numeric.eq} is below gte ${numeric.gte}.`,
      );
    }

    if (
      numeric.eq !== undefined &&
      numeric.lte !== undefined &&
      numeric.eq > numeric.lte
    ) {
      fail(
        `numeric constraints for attribute ${attributeId} are contradictory: ` +
          `eq ${numeric.eq} exceeds lte ${numeric.lte}.`,
      );
    }
  }
}

/**
 * Проверяет полный SearchSpec
 * против выбранного CategoryProfile.
 *
 * Здесь проверяется смысл:
 *
 * - существует ли attribute;
 * - разрешён ли operator;
 * - правильный ли тип value;
 * - правильная ли unit;
 * - соответствует ли category profile;
 * - совместимы ли numeric constraints между собой.
 */
export function assertSearchSpecMatchesCategoryProfile(
  specRaw: unknown,

  profileRaw: unknown,
): void {
  const profile = CategoryProfileSchema.parse(profileRaw);

  const parsed = SearchSpecSchema.safeParse(specRaw);

  const spec = parsed.success
    ? parsed.data
    : SearchSpecDraftSchema.parse(specRaw);

  if (spec.category !== profile.id) {
    fail(
      `category ${String(spec.category)} does not match profile ${profile.id}.`,
    );
  }

  for (const constraint of spec.constraints) {
    assertSearchConstraint(profile, constraint);
  }

  /**
   * Только после individual validation.
   *
   * Теперь мы уже знаем, что numeric
   * values действительно числа
   * и units соответствуют profile.
   */
  assertNumericConstraintCompatibility(profile, spec.constraints);
}

/**
 * Проверяет SearchSpec patch
 * до его применения.
 *
 * Смена основной category через REFINE
 * не допускается.
 *
 * Другая category = новый SEARCH.
 *
 * Также проверяем противоречия,
 * существующие прямо внутри patch.set.
 *
 * Противоречие между текущим SearchSpec
 * и patch проверяется после применения patch
 * через assertSearchSpecMatchesCategoryProfile().
 */
export function assertSearchSpecPatchMatchesCategoryProfile(
  patchRaw: unknown,

  profileRaw: unknown,
): void {
  const profile = CategoryProfileSchema.parse(profileRaw);

  const patch = SearchSpecPatchSchema.parse(patchRaw);

  if (patch.category !== undefined && patch.category !== profile.id) {
    fail(
      `patch category ${String(patch.category)} does not match profile ${
        profile.id
      }; use a new SEARCH.`,
    );
  }

  for (const constraint of patch.set) {
    assertSearchConstraint(profile, constraint);
  }

  for (const selector of patch.clear) {
    assertCategoryProfileAttributeSelector(selector, profile);
  }

  assertNumericConstraintCompatibility(profile, patch.set);
}
