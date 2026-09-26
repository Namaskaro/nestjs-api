import {
  CategoryProfileSchema,
  type AttributeDefinition,
  type CategoryProfile,
} from '../consultation-core.schema';

export type CategoryProfileAttributeOperator =
  | 'eq'
  | 'contains'
  | 'lte'
  | 'gte';

export type CategoryProfileAttributeValue = string | number | boolean;

export type CategoryProfileAttributeCondition = {
  attributeId: string;

  operator: CategoryProfileAttributeOperator;

  value: CategoryProfileAttributeValue;

  unit: string | null;
};

export type CategoryProfileAttributeSelector = Pick<
  CategoryProfileAttributeCondition,
  'attributeId' | 'operator'
>;

function fail(message: string): never {
  throw new Error(`CategoryProfileAttributeValidation: ${message}`);
}

export function requireCategoryProfileAttribute(
  profileRaw: CategoryProfile,

  attributeId: string,
): AttributeDefinition {
  const profile = CategoryProfileSchema.parse(profileRaw);

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

  operator: CategoryProfileAttributeOperator,
): void {
  if (!attribute.allowedOperators.includes(operator)) {
    fail(`operator ${operator} is not allowed for attribute ${attribute.id}.`);
  }
}

function assertValue(
  attribute: AttributeDefinition,

  value: CategoryProfileAttributeValue,
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
       * Structured condition хранит один
       * проверяемый member множества.
       *
       * Например:
       *
       * sizes contains "42"
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

  condition: CategoryProfileAttributeCondition,
): void {
  if (condition.unit !== attribute.unit) {
    fail(
      `attribute ${attribute.id} requires unit ${String(
        attribute.unit,
      )}, received ${String(condition.unit)}.`,
    );
  }
}

/**
 * Общая deterministic semantic validation
 * typed attribute condition.
 *
 * Ей могут пользоваться разные boundaries:
 *
 * - SearchSpec hard constraint;
 * - soft Memory criterion;
 * - другие typed contracts.
 *
 * Здесь нет решения о том, является ли
 * условие hard или soft. Это ответственность
 * конкретного вызывающего контракта.
 */
export function assertCategoryProfileAttributeCondition(
  condition: CategoryProfileAttributeCondition,

  profileRaw: CategoryProfile,
): void {
  const attribute = requireCategoryProfileAttribute(
    profileRaw,
    condition.attributeId,
  );

  assertOperator(attribute, condition.operator);

  assertValue(attribute, condition.value);

  assertUnit(attribute, condition);
}

/**
 * Проверяет semantic target без value/unit.
 *
 * Нужен, например, для:
 *
 * - SearchSpec clear;
 * - Memory forget.
 */
export function assertCategoryProfileAttributeSelector(
  selector: CategoryProfileAttributeSelector,

  profileRaw: CategoryProfile,
): void {
  const attribute = requireCategoryProfileAttribute(
    profileRaw,
    selector.attributeId,
  );

  assertOperator(attribute, selector.operator);
}
