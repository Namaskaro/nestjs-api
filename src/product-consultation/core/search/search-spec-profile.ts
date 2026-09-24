import {
  CategoryProfileSchema,
  type AttributeDefinition,
} from '../consultation-core.schema';

import {
  SearchSpecDraftSchema,
  SearchSpecPatchSchema,
  SearchSpecSchema,
  type SearchConstraint,
  type SearchConstraintSelector,
} from './search-spec.schema';

function fail(message: string): never {
  throw new Error(`SearchSpecProfile: ${message}`);
}

function findAttribute(
  profile: ReturnType<typeof CategoryProfileSchema.parse>,

  attributeId: string,
): AttributeDefinition {
  const attribute = profile.attributes.find(
    (candidate) => candidate.id === attributeId,
  );

  if (!attribute) {
    fail(`unknown attribute ${attributeId} for category ${profile.id}.`);
  }

  return attribute;
}

function assertOperator(
  attribute: AttributeDefinition,

  operator: SearchConstraint['operator'],
): void {
  if (!attribute.allowedOperators.includes(operator)) {
    fail(`operator ${operator} is not allowed for attribute ${attribute.id}.`);
  }
}

function assertValue(
  attribute: AttributeDefinition,

  value: SearchConstraint['value'],
): void {
  switch (attribute.kind) {
    case 'text': {
      if (typeof value !== 'string') {
        fail(`attribute ${attribute.id} requires string value.`);
      }

      return;
    }

    case 'number': {
      if (typeof value !== 'number') {
        fail(`attribute ${attribute.id} requires number value.`);
      }

      return;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        fail(`attribute ${attribute.id} requires boolean value.`);
      }

      return;
    }

    case 'set': {
      /**
       * SearchSpec содержит один
       * искомый элемент множества.
       *
       * Например:
       *
       * materials contains "leather"
       */
      if (typeof value !== 'string') {
        fail(`attribute ${attribute.id} requires string member value.`);
      }

      return;
    }
  }
}

function assertUnit(
  attribute: AttributeDefinition,

  constraint: SearchConstraint,
): void {
  if (constraint.unit !== attribute.unit) {
    fail(
      `attribute ${attribute.id} requires unit ${String(
        attribute.unit,
      )}, received ${String(constraint.unit)}.`,
    );
  }
}

function assertConstraint(
  profile: ReturnType<typeof CategoryProfileSchema.parse>,

  constraint: SearchConstraint,
): void {
  const attribute = findAttribute(profile, constraint.attributeId);

  assertOperator(attribute, constraint.operator);

  assertValue(attribute, constraint.value);

  assertUnit(attribute, constraint);
}

function assertSelector(
  profile: ReturnType<typeof CategoryProfileSchema.parse>,

  selector: SearchConstraintSelector,
): void {
  const attribute = findAttribute(profile, selector.attributeId);

  assertOperator(attribute, selector.operator);
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
    const attribute = findAttribute(profile, constraint.attributeId);

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
       * Тип уже проверяется assertConstraint().
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
    assertConstraint(profile, constraint);
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
    assertConstraint(profile, constraint);
  }

  for (const selector of patch.clear) {
    assertSelector(profile, selector);
  }

  assertNumericConstraintCompatibility(profile, patch.set);
}
