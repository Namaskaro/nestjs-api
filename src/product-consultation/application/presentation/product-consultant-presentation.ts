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

import {
  ConsultationAgentResultSchema,
  type ConsultationAgentResult,
} from '@/src/product-consultation/application/consultation-agent/schemas/consultation-agent.schema';

const NEED_ID = 'current-consultation-task';

const SEMANTIC_STYLE_ATTRIBUTE_ID = 'semantic.styleAssociations';

const MAX_SEMANTIC_STYLE_VALUES = 3;

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

function buildFactRows(input: {
  comparison: AgentComparisonView;

  state: ProductConsultationState;

  requestedAttributeIds: readonly string[];
}): ComparisonPresentation['rows'] {
  const profile = getCategoryProfile(input.comparison.profileId);

  const definitionById = new Map(
    profile.attributes.map((attribute) => [attribute.id, attribute] as const),
  );

  const requested = new Set(input.requestedAttributeIds);

  const requestedOrder = new Map(
    input.requestedAttributeIds.map(
      (attributeId, index) => [attributeId, index] as const,
    ),
  );

  const showSizes =
    requested.has('sizes') ||
    requested.has('size') ||
    hasSizeContext(input.state);

  return input.comparison.rows
    .filter((row) => {
      if (
        (row.attributeId === 'sizes' || row.attributeId === 'size') &&
        !showSizes
      ) {
        return false;
      }

      /*
       * Цена уже крупно показана
       * в верхних карточках.
       *
       * Отдельной строкой таблицы
       * показываем её только тогда,
       * когда пользователь сам попросил
       * сравнить цену.
       */
      if (row.attributeId === 'price' && !requested.has('price')) {
        return false;
      }

      /*
       * Явно запрошенный критерий
       * показываем даже когда значения
       * одинаковые или неизвестные.
       *
       * Это важно для запроса вроде:
       *
       * "сравни по материалу".
       */
      if (requested.has(row.attributeId)) {
        return true;
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
    })
    .sort((left, right) => {
      const leftRequested = requestedOrder.get(left.attributeId);

      const rightRequested = requestedOrder.get(right.attributeId);

      if (leftRequested !== undefined && rightRequested !== undefined) {
        return leftRequested - rightRequested;
      }

      if (leftRequested !== undefined) {
        return -1;
      }

      if (rightRequested !== undefined) {
        return 1;
      }

      return 0;
    });
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

function semanticStyleRow(input: {
  products: ComparisonPresentation['products'];

  representations: ReadonlyMap<string, ProductSemanticRepresentation>;
}): ComparisonPresentation['rows'][number] | null {
  const values = input.products.map((product) => {
    const representation = input.representations.get(product.id);

    if (!representation) {
      return null;
    }

    const items = [
      ...new Set(
        representation.styleAssociations
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].slice(
      0,

      MAX_SEMANTIC_STYLE_VALUES,
    );

    if (items.length === 0) {
      return null;
    }

    return {
      productId: product.id,

      items,
    };
  });

  /*
   * Не строим semantic row,
   * если enrichment неполный.
   *
   * Отсутствие semantic data
   * не является различием товара.
   */
  if (values.some((value) => value === null)) {
    return null;
  }

  const complete = values.filter(
    (
      value,
    ): value is {
      productId: string;

      items: string[];
    } => value !== null,
  );

  const signatures = complete.map((value) => normalizedStringSet(value.items));

  if (new Set(signatures).size <= 1) {
    return null;
  }

  return {
    attributeId: SEMANTIC_STYLE_ATTRIBUTE_ID,

    /*
     * Важно:
     *
     * это не объективное "назначение"
     * товара и не ProductFact.
     *
     * Формулировка специально
     * показывает пользователю,
     * что это мягкая интерпретация.
     */
    label: 'Стиль / ассоциации',

    state: 'different',

    range: null,

    cells: complete.map((value) => ({
      productId: value.productId,

      status: 'known',

      value: value.items,

      unit: null,

      displayValue: null,
    })),
  };
}

function buildRows(input: {
  comparison: AgentComparisonView;

  products: ComparisonPresentation['products'];

  state: ProductConsultationState;

  requestedAttributeIds: readonly string[];

  semanticRepresentations: ReadonlyMap<string, ProductSemanticRepresentation>;
}): ComparisonPresentation['rows'] {
  const factRows = buildFactRows({
    comparison: input.comparison,

    state: input.state,

    requestedAttributeIds: input.requestedAttributeIds,
  });

  const styleRow = semanticStyleRow({
    products: input.products,

    representations: input.semanticRepresentations,
  });

  return styleRow ? [...factRows, styleRow] : factRows;
}

function unavailableRequestedLabels(input: {
  comparison: AgentComparisonView;

  rows: ComparisonPresentation['rows'];

  requestedAttributeIds: readonly string[];
}): string[] {
  if (input.requestedAttributeIds.length === 0) {
    return [];
  }

  const profile = getCategoryProfile(input.comparison.profileId);

  const definitionById = new Map(
    profile.attributes.map((attribute) => [attribute.id, attribute] as const),
  );

  return input.requestedAttributeIds.flatMap((attributeId) => {
    const definition = definitionById.get(attributeId);

    if (!definition) {
      return [];
    }

    const row = input.rows.find(
      (candidate) => candidate.attributeId === attributeId,
    );

    if (!row) {
      return [definition.label];
    }

    const hasKnownValue = row.cells.some((cell) => cell.status === 'known');

    return hasKnownValue ? [] : [definition.label];
  });
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

export function prepareProductConsultantComparisonPresentation(input: {
  comparison: AgentComparisonView;

  products: readonly ProductDetails[];

  state: ProductConsultationState;

  currentQuery: string;

  requestedAttributeIds?: readonly string[];

  semanticRepresentations?: ReadonlyMap<string, ProductSemanticRepresentation>;
}) {
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

  const requestedAttributeIds = input.requestedAttributeIds ?? [];

  const rows = buildRows({
    comparison: input.comparison,

    products,

    state: input.state,

    requestedAttributeIds,

    semanticRepresentations: input.semanticRepresentations ?? new Map(),
  });

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

    /*
     * Legacy transport field.
     *
     * Новый active COMPARE больше не
     * строит текстовую простыню.
     *
     * Все различия представлены
     * структурированными rows.
     */
    keyDifferences: [],

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

      keyDifferences: [],

      guidance,
    },

    unavailableRequestedLabels: unavailableRequestedLabels({
      comparison: input.comparison,

      rows,

      requestedAttributeIds,
    }),
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
