import type { ProductNeedMemory } from '../context/product-context.schema';

import type {
  CategoryProfile,
  ProductComparison,
  ProductDetails,
  ProductFact,
} from '../consultation-core/consultation-core.schema';

import {
  ComparisonPresentationSchema,
  type ComparisonPresentation,
  type ComparisonSynthesisInput,
  type ComparisonSynthesisOutput,
} from '../../../support-agent/agents/product-agent/schemas/comparison-presentation.schema';

import { buildProductSnapshot } from './product-presentation';

const MAX_KEY_DIFFERENCES = 4;

export type PreparedComparisonPresentation = {
  comparisonId: string;
  needId: string;
  goal: string;
  products: ComparisonPresentation['products'];
  rows: ComparisonPresentation['rows'];
  keyDifferences: string[];
  synthesisInput: ComparisonSynthesisInput;
  unavailableRequestedLabels: string[];
};

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, Math.max(0, maxLength - 1)) + '…';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatFact(
  fact: Pick<ProductFact, 'status' | 'value' | 'unit' | 'displayValue'>,
): string {
  if (fact.status !== 'known') {
    return 'не указано';
  }

  if (fact.displayValue) {
    return fact.displayValue;
  }

  if (Array.isArray(fact.value)) {
    return fact.value.join(', ');
  }

  if (typeof fact.value === 'boolean') {
    return fact.value ? 'да' : 'нет';
  }

  if (fact.value === null) {
    return 'не указано';
  }

  if (typeof fact.value === 'number') {
    const formatted = formatNumber(fact.value);

    return fact.unit ? `${formatted} ${fact.unit}` : formatted;
  }

  return fact.unit ? `${String(fact.value)} ${fact.unit}` : String(fact.value);
}

function comparisonGoal(need: ProductNeedMemory): string {
  const storedGoals = need.consultation.goals
    .map((goal) => goal.text)
    .filter(Boolean);

  return clip(
    [need.semanticQuery, ...storedGoals]
      .filter((value, index, values) => values.indexOf(value) === index)
      .join('. '),
    1000,
  );
}

function orderedProducts(
  comparison: ProductComparison,
  products: ProductDetails[],
): ProductDetails[] {
  const byId = new Map(
    products.map((product) => [product.id, product] as const),
  );

  return comparison.productIds.map((productId) => {
    const product = byId.get(productId);

    if (!product) {
      throw new Error(
        `ProductAgent: product details отсутствуют для ${productId}`,
      );
    }

    return product;
  });
}

function comparisonAttributeIds(
  profile: CategoryProfile,
  need: ProductNeedMemory,
  requestedAttributeIds: readonly string[],
): Set<string> {
  const knownAttributes = new Set(
    profile.attributes.map((attribute) => attribute.id),
  );

  return new Set(
    [
      ...profile.defaultCriteria,
      ...profile.criticalAttributes,
      ...need.consultation.criteria.map((criterion) => criterion.attributeId),
      ...requestedAttributeIds,
    ].filter((attributeId) => knownAttributes.has(attributeId)),
  );
}

function buildPresentationRows(
  comparison: ProductComparison,
  profile: CategoryProfile,
  need: ProductNeedMemory,
  requestedAttributeIds: readonly string[],
): ComparisonPresentation['rows'] {
  const requested = new Set(requestedAttributeIds);

  const allowed = comparisonAttributeIds(profile, need, requestedAttributeIds);

  return comparison.rows
    .filter((row) => allowed.has(row.attributeId))
    .filter((row) => {
      if (requested.has(row.attributeId)) {
        return true;
      }

      const hasKnownFact = row.cells.some(
        (cell) => cell.fact.status === 'known',
      );

      if (!hasKnownFact) {
        return false;
      }

      return row.state !== 'same';
    })
    .map((row) => ({
      attributeId: row.attributeId,
      label: row.label,
      state: row.state,
      range: row.range,

      cells: row.cells.map((cell) => ({
        productId: cell.productId,
        status: cell.fact.status,
        value: cell.fact.value,
        unit: cell.fact.unit,
        displayValue: cell.fact.displayValue,
      })),
    }));
}

function unavailableRequestedLabels(
  rows: ComparisonPresentation['rows'],
  requestedAttributeIds: readonly string[],
): string[] {
  const requested = new Set(requestedAttributeIds);

  return rows
    .filter(
      (row) =>
        requested.has(row.attributeId) &&
        row.cells.every((cell) => cell.status !== 'known'),
    )
    .map((row) => row.label);
}

function deterministicDifference(
  row: ComparisonPresentation['rows'][number],
  products: ComparisonPresentation['products'],
): string {
  const titleById = new Map(
    products.map((product) => [product.id, product.title] as const),
  );

  const values = row.cells.map((cell) => {
    const title = titleById.get(cell.productId) ?? 'Товар';

    return `${title} — ${formatFact(cell)}`;
  });

  const range =
    row.state === 'numeric_difference' && row.range
      ? ` Разница — ${formatNumber(row.range.spread)}${
          row.range.unit ? ` ${row.range.unit}` : ''
        }.`
      : '';

  return clip(`${row.label}: ${values.join('; ')}.${range}`, 500);
}

function buildKeyDifferences(
  rows: ComparisonPresentation['rows'],
  products: ComparisonPresentation['products'],
): string[] {
  return rows
    .filter((row) => {
      if (row.state === 'same') {
        return false;
      }

      return row.cells.some((cell) => cell.status === 'known');
    })
    .slice(0, MAX_KEY_DIFFERENCES)
    .map((row) => deterministicDifference(row, products));
}

function buildSynthesisRows(
  rows: ComparisonPresentation['rows'],
  productIds: readonly string[],
): ComparisonSynthesisInput['rows'] {
  const positionByProductId = new Map(
    productIds.map((productId, index) => [productId, index + 1] as const),
  );

  return rows.map((row) => ({
    attributeId: row.attributeId,
    label: row.label,
    state: row.state,
    range: row.range,

    cells: row.cells.map((cell) => {
      const position = positionByProductId.get(cell.productId);

      if (!position) {
        throw new Error(
          `ProductAgent: comparison position отсутствует для ${cell.productId}`,
        );
      }

      return {
        position,
        status: cell.status,
        value: cell.value,
        unit: cell.unit,
        displayValue: cell.displayValue,
      };
    }),
  }));
}

export function prepareComparisonPresentation({
  comparison,
  products,
  need,
  profile,
  currentQuery,
  requestedAttributeIds,
}: {
  comparison: ProductComparison;
  products: ProductDetails[];
  need: ProductNeedMemory;
  profile: CategoryProfile;
  currentQuery: string;
  requestedAttributeIds: readonly string[];
}): PreparedComparisonPresentation {
  const ordered = orderedProducts(comparison, products);

  const goal = comparisonGoal(need);

  const presentationProducts: ComparisonPresentation['products'] = ordered.map(
    (product, index) => ({
      ...buildProductSnapshot({
        product,
        profile,
      }),

      position: index + 1,
    }),
  );

  const rows = buildPresentationRows(
    comparison,
    profile,
    need,
    requestedAttributeIds,
  );

  const keyDifferences = buildKeyDifferences(rows, presentationProducts);

  const synthesisRows = buildSynthesisRows(rows, comparison.productIds);

  const synthesisAttributeIds = new Set(
    synthesisRows.map((row) => row.attributeId),
  );

  const guidance = profile.guidance
    .filter((rule) =>
      rule.attributeIds.some((attributeId) =>
        synthesisAttributeIds.has(attributeId),
      ),
    )
    .slice(0, 8)
    .map((rule) => ({
      when: rule.when,
      attributeIds: rule.attributeIds,
      instruction: rule.instruction,
    }));

  const synthesisInput: ComparisonSynthesisInput = {
    goal,

    currentQuery: clip(currentQuery, 500),

    preferences: need.preferences.slice(0, 10),

    goals: need.consultation.goals
      .slice(0, 8)
      .map((storedGoal) => storedGoal.text),

    products: presentationProducts.map((product) => ({
      position: product.position,
      title: product.title,
    })),

    rows: synthesisRows,

    keyDifferences,

    guidance,
  };

  return {
    comparisonId: comparison.comparisonId,

    needId: comparison.needId,

    goal,

    products: presentationProducts,

    rows,

    keyDifferences,

    synthesisInput,

    unavailableRequestedLabels: unavailableRequestedLabels(
      rows,
      requestedAttributeIds,
    ),
  };
}

function fallbackRecommendation(
  prepared: PreparedComparisonPresentation,
): string {
  const labels = prepared.rows
    .filter((row) => row.state !== 'same')
    .map((row) => row.label)
    .slice(0, MAX_KEY_DIFFERENCES);

  if (!labels.length) {
    return clip(
      `По доступным проверенным характеристикам существенных различий между вариантами не обнаружено. Для задачи «${prepared.goal}» явного лидера нет.`,
      1200,
    );
  }

  return clip(
    `По проверенным данным варианты различаются прежде всего по: ${labels.join(
      ', ',
    )}. Для задачи «${
      prepared.goal
    }» явного лидера без дополнительной интерпретации нет — ориентируйтесь на эти различия.`,
    1200,
  );
}

function deterministicNote(
  prepared: PreparedComparisonPresentation,
): string | null {
  if (!prepared.unavailableRequestedLabels.length) {
    return null;
  }

  return clip(
    `Недостаточно данных по явно запрошенным характеристикам: ${prepared.unavailableRequestedLabels.join(
      ', ',
    )}.`,
    600,
  );
}

export function finalizeComparisonPresentation(
  prepared: PreparedComparisonPresentation,
  synthesis: ComparisonSynthesisOutput | null,
): ComparisonPresentation {
  const recommendedProductId =
    synthesis?.preferredPosition == null
      ? null
      : prepared.products.find(
          (product) => product.position === synthesis.preferredPosition,
        )?.id ?? null;

  return ComparisonPresentationSchema.parse({
    comparisonId: prepared.comparisonId,

    needId: prepared.needId,

    goal: prepared.goal,

    products: prepared.products,

    rows: prepared.rows,

    keyDifferences: prepared.keyDifferences,

    recommendation:
      synthesis?.recommendation ?? fallbackRecommendation(prepared),

    recommendedProductId,

    note: deterministicNote(prepared),
  });
}

export function buildComparisonMessage(
  presentation: ComparisonPresentation,
): string {
  const lines: string[] = ['Сравнил выбранные товары.'];

  if (presentation.keyDifferences.length) {
    lines.push(
      '',
      'Ключевые различия:',
      ...presentation.keyDifferences.map((difference) => `— ${difference}`),
    );
  }

  lines.push('', `Что выбрать: ${presentation.recommendation}`);

  if (presentation.note) {
    lines.push('', presentation.note);
  }

  return lines.join('\n');
}
