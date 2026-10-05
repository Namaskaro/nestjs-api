import type { ProductSemanticRepresentation } from '@/src/ai/schemas/semantic-product-representation.schema';

import type {
  AgentComparisonView,
  ProductDetails,
} from '@/src/product-consultation/core/consultation-core.schema';

import type { ProductConsultationState } from '@/src/product-consultation/core/state/consultation-state.schema';

import { getCategoryProfile } from '@/src/product-consultation/core/profiles';

import {
  buildProductDetailsPresentation,
  buildProductSnapshot,
} from '@/src/product-consultation/application/presentation/product-presentation';

import { productPresentationDisplayValue } from '@/src/product-consultation/application/presentation/product-presentation-value';

import type {
  ComparisonPresentation,
  ComparisonSynthesisInput,
} from '@/src/product-consultation/application/presentation/comparison-presentation.schema';

import type { PreparedComparisonPresentation } from '@/src/product-consultation/application/presentation/comparison-presentation';

import {
  ConsultationAgentResultSchema,
  type ConsultationAgentResult,
} from '@/src/product-consultation/application/consultation-agent/schemas/consultation-agent.schema';

const NEED_ID = 'current-consultation-task';

const MAX_KEY_DIFFERENCES = 4;

function clip(
  value: string,

  maxLength: number,
): string {
  if (value.length <= maxLength) {
    return value;
  }

  return (
    value.slice(
      0,

      Math.max(0, maxLength - 1),
    ) + '…'
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatValue(input: {
  status: 'known' | 'unknown' | 'not_applicable' | 'conflicting';

  value?: string | number | boolean | string[] | null;

  unit?: string | null;

  displayValue?: string | null;
}): string {
  if (input.status !== 'known') {
    return 'не указано';
  }

  if (input.displayValue) {
    return input.displayValue;
  }

  if (Array.isArray(input.value)) {
    return input.value.join(', ');
  }

  if (typeof input.value === 'boolean') {
    return input.value ? 'да' : 'нет';
  }

  if (input.value === null || input.value === undefined) {
    return 'не указано';
  }

  if (typeof input.value === 'number') {
    const formatted = formatNumber(input.value);

    return input.unit ? `${formatted} ${input.unit}` : formatted;
  }

  return input.unit ? `${input.value} ${input.unit}` : input.value;
}

function currentGoal(state: ProductConsultationState): string {
  const goals = state.memory.memory.goals
    .map((goal) => goal.text.trim())
    .filter(Boolean);

  if (goals.length === 0) {
    return 'Сравнение выбранных товаров';
  }

  return clip(
    goals
      .filter((value, index, all) => all.indexOf(value) === index)
      .join('. '),

    1000,
  );
}

function hasSizeContext(state: ProductConsultationState): boolean {
  const searchHasSize =
    state.search?.constraints.some(
      (constraint) =>
        constraint.attributeId === 'sizes' || constraint.attributeId === 'size',
    ) ?? false;

  const memoryHasSize = state.memory.memory.criteria.some(
    (criterion) =>
      criterion.attributeId === 'sizes' || criterion.attributeId === 'size',
  );

  return searchHasSize || memoryHasSize;
}

function orderedProducts(
  comparison: AgentComparisonView,

  products: readonly ProductDetails[],
): ProductDetails[] {
  const byId = new Map(
    products.map((product) => [product.id, product] as const),
  );

  return comparison.productIds.map((productId) => {
    const product = byId.get(productId);

    if (!product) {
      throw new Error(
        `ProductConsultantPresentation: product ${productId} is missing.`,
      );
    }

    return product;
  });
}

function buildRows(input: {
  comparison: AgentComparisonView;

  state: ProductConsultationState;
}): ComparisonPresentation['rows'] {
  const profile = getCategoryProfile(input.comparison.profileId);

  const definitionById = new Map(
    profile.attributes.map((attribute) => [attribute.id, attribute] as const),
  );

  const showSizes = hasSizeContext(input.state);

  return input.comparison.rows
    .filter((row) => {
      if (row.attributeId === 'sizes' && !showSizes) {
        return false;
      }

      if (row.state === 'same') {
        return false;
      }

      return row.cells.some((cell) => cell.status === 'known');
    })
    .flatMap((row) => {
      const definition = definitionById.get(row.attributeId);

      if (!definition) {
        return [];
      }

      return [
        {
          attributeId: row.attributeId,

          label: definition.label,

          state: row.state,

          range: row.range,

          cells: row.cells.map((cell) => ({
            productId: cell.productId,

            status: cell.status,

            value: cell.value,

            unit: cell.unit,

            displayValue: productPresentationDisplayValue({
              attributeId: row.attributeId,

              status: cell.status,

              value: cell.value,

              displayValue: cell.displayValue,
            }),
          })),
        },
      ];
    });
}

function deterministicFactDifference(
  row: ComparisonPresentation['rows'][number],

  products: ComparisonPresentation['products'],
): string {
  const titleById = new Map(
    products.map((product) => [product.id, product.title] as const),
  );

  const values = row.cells.map((cell) => {
    const title = titleById.get(cell.productId) ?? 'Товар';

    return `${title} — ${formatValue(cell)}`;
  });

  const range =
    row.state === 'numeric_difference' && row.range
      ? ` Разница — ${formatNumber(row.range.spread)}${
          row.range.unit ? ` ${row.range.unit}` : ''
        }.`
      : '';

  return clip(
    `${row.label}: ${values.join('; ')}.${range}`,

    500,
  );
}

function normalizedStringSet(values: readonly string[]): string {
  return JSON.stringify(
    [
      ...new Set(
        values
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => value.toLocaleLowerCase('ru-RU')),
      ),
    ].sort(),
  );
}

function semanticDifference(input: {
  label: string;

  products: ComparisonPresentation['products'];

  representations: ReadonlyMap<string, ProductSemanticRepresentation>;

  read: (representation: ProductSemanticRepresentation) => readonly string[];
}): string | null {
  const values = input.products.map((product) => {
    const representation = input.representations.get(product.id);

    if (!representation) {
      return null;
    }

    const items = [
      ...new Set(
        input
          .read(representation)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];

    return items.length > 0
      ? {
          title: product.title,

          items,
        }
      : null;
  });

  if (values.some((value) => value === null)) {
    return null;
  }

  const complete = values.filter(
    (
      value,
    ): value is {
      title: string;

      items: string[];
    } => value !== null,
  );

  const signatures = complete.map((value) => normalizedStringSet(value.items));

  if (new Set(signatures).size <= 1) {
    return null;
  }

  return clip(
    `${input.label}: ${complete
      .map((value) => `${value.title} — ${value.items.join(', ')}`)
      .join('; ')}.`,

    500,
  );
}

function buildSemanticDifferences(
  products: ComparisonPresentation['products'],

  representations: ReadonlyMap<string, ProductSemanticRepresentation>,
): string[] {
  return [
    semanticDifference({
      label: 'Стиль по описанию',

      products,

      representations,

      read: (representation) => representation.styleAssociations,
    }),

    semanticDifference({
      label: 'Сценарии использования по описанию',

      products,

      representations,

      read: (representation) => representation.useCases,
    }),

    semanticDifference({
      label: 'Целевая аудитория по описанию',

      products,

      representations,

      read: (representation) => representation.targetAudience,
    }),
  ].filter((value): value is string => value !== null);
}

function buildKeyDifferences(
  rows: ComparisonPresentation['rows'],

  products: ComparisonPresentation['products'],

  semanticRepresentations: ReadonlyMap<string, ProductSemanticRepresentation>,
): string[] {
  const factDifferences = rows
    .filter(
      (row) =>
        row.state !== 'same' &&
        row.cells.some((cell) => cell.status === 'known'),
    )
    .map((row) => ({
      attributeId: row.attributeId,

      text: deterministicFactDifference(
        row,

        products,
      ),
    }));

  const nonPriceFacts = factDifferences.filter(
    (difference) => difference.attributeId !== 'price',
  );

  const priceFacts = factDifferences.filter(
    (difference) => difference.attributeId === 'price',
  );

  const semanticDifferences = buildSemanticDifferences(
    products,

    semanticRepresentations,
  );

  const ordered = [
    ...nonPriceFacts.slice(0, 2).map((difference) => difference.text),

    ...semanticDifferences.slice(0, 2),

    ...nonPriceFacts.slice(2).map((difference) => difference.text),

    ...semanticDifferences.slice(2),

    ...priceFacts.map((difference) => difference.text),
  ];

  return [...new Set(ordered)].slice(
    0,

    MAX_KEY_DIFFERENCES,
  );
}

function buildSynthesisRows(
  rows: ComparisonPresentation['rows'],

  productIds: readonly string[],
): ComparisonSynthesisInput['rows'] {
  const positionById = new Map(
    productIds.map((productId, index) => [productId, index + 1] as const),
  );

  return rows.map((row) => ({
    attributeId: row.attributeId,

    label: row.label,

    state: row.state,

    range: row.range,

    cells: row.cells.map((cell) => {
      const position = positionById.get(cell.productId);

      if (position === undefined) {
        throw new Error(
          `ProductConsultantPresentation: position for ${cell.productId} is missing.`,
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

function comparisonAspects(keyDifferences: readonly string[]): string[] {
  return [
    ...new Set(
      keyDifferences
        .map((difference) => {
          const separator = difference.indexOf(':');

          if (separator < 0) {
            return null;
          }

          const label = difference
            .slice(
              0,

              separator,
            )
            .trim();

          if (!label) {
            return null;
          }

          return label.charAt(0).toLocaleLowerCase('ru-RU') + label.slice(1);
        })
        .filter((value): value is string => value !== null),
    ),
  ];
}

function joinNatural(values: readonly string[]): string {
  if (values.length === 0) {
    return '';
  }

  if (values.length === 1) {
    return values[0];
  }

  return `${values.slice(0, -1).join(', ')} и ${values.at(-1)}`;
}

export function buildNeutralComparisonRecommendation(
  prepared: PreparedComparisonPresentation,
): string {
  const aspects = comparisonAspects(prepared.keyDifferences);

  if (aspects.length === 0) {
    return 'По имеющимся данным заметных различий, которые дают одному варианту явное преимущество, нет. Если назовёте главный критерий выбора, помогу определиться.';
  }

  return `Основные различия — ${joinNatural(
    aspects,
  )}. Без вашего приоритета явного лидера нет; если скажете, что для вас важнее, помогу выбрать.`;
}

export function prepareProductConsultantComparisonPresentation(input: {
  comparison: AgentComparisonView;

  products: readonly ProductDetails[];

  state: ProductConsultationState;

  currentQuery: string;

  semanticRepresentations?: ReadonlyMap<string, ProductSemanticRepresentation>;
}): PreparedComparisonPresentation {
  const profile = getCategoryProfile(input.comparison.profileId);

  const ordered = orderedProducts(
    input.comparison,

    input.products,
  );

  const goal = currentGoal(input.state);

  const products: ComparisonPresentation['products'] = ordered.map(
    (product, index) => ({
      ...buildProductSnapshot({
        product,

        profile,
      }),

      position: index + 1,
    }),
  );

  const rows = buildRows({
    comparison: input.comparison,

    state: input.state,
  });

  const keyDifferences = buildKeyDifferences(
    rows,

    products,

    input.semanticRepresentations ?? new Map(),
  );

  const synthesisRows = buildSynthesisRows(
    rows,

    input.comparison.productIds,
  );

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

  const preferences = [
    ...new Set(
      input.state.memory.memory.criteria.map(
        (criterion) => criterion.sourceText,
      ),
    ),
  ].slice(0, 10);

  const goals = input.state.memory.memory.goals
    .slice(0, 8)
    .map((goal) => goal.text);

  return {
    comparisonId: input.comparison.comparisonId,

    needId: input.comparison.needId,

    goal,

    products,

    rows,

    keyDifferences,

    synthesisInput: {
      goal,

      currentQuery: clip(
        input.currentQuery,

        500,
      ),

      preferences,

      goals,

      products: products.map((product) => ({
        position: product.position,

        title: product.title,
      })),

      rows: synthesisRows,

      keyDifferences,

      guidance,
    },

    unavailableRequestedLabels: [],
  };
}

function decision(query: string) {
  return {
    needId: NEED_ID,

    query,

    nextAction: 'SHOW_RESULTS' as const,

    suggestedFields: [],

    alternativePlan: null,

    question: null,
  };
}

export function buildProductDetailsConsultation(input: {
  state: ProductConsultationState;

  product: ProductDetails;

  focusAttributeIds: readonly string[];

  message: string;
}): ConsultationAgentResult {
  const profile = getCategoryProfile(input.product.profileId);

  const query = input.state.search?.semanticIntent ?? input.product.title;

  return ConsultationAgentResultSchema.parse({
    message: input.message,

    decisions: [decision(query)],

    recommendations: [],

    productDetails: [
      {
        needId: NEED_ID,

        product: input.product,
      },
    ],

    comparisons: [],

    comparisonPresentation: null,

    productDetailsPresentation: buildProductDetailsPresentation({
      needId: NEED_ID,

      product: input.product,

      profile,

      focusAttributeIds: input.focusAttributeIds,
    }),
  });
}

export function buildComparisonConsultation(input: {
  state: ProductConsultationState;

  presentation: ComparisonPresentation;

  message: string;
}): ConsultationAgentResult {
  const query = input.state.search?.semanticIntent ?? input.presentation.goal;

  return ConsultationAgentResultSchema.parse({
    message: input.message,

    decisions: [decision(query)],

    recommendations: [],

    productDetails: [],

    comparisons: [],

    comparisonPresentation: input.presentation,

    productDetailsPresentation: null,
  });
}
