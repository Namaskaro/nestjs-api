import { randomUUID } from 'node:crypto';

import {
  readProductContext,
  type ProductContext,
  type ProductNeedMemory,
  type ProductReference,
} from '@/src/product-consultation/application/context/product-context.schema';

import { HandoffRequestSchema } from '@/src/support-agent/agents/handoff-agent/schemas/handoff.schema';

import { getCategoryProfile } from '@/src/product-consultation/core/profiles';

import { touchConsultationSession } from '@/src/product-consultation/application/session/consultation-session';

import { emptyConsultationMemory } from '@/src/product-consultation/core/consultation-core.schema';

import type { ProductTurn } from '@/src/product-consultation/application/agent/product-agent.state';

import {
  ProductPlannerResultSchema,
  type ProductFilterPatch,
  type ProductNeedPatch,
  type ProductPlannerResult,
} from '@/src/product-consultation/application/planner/product-planner-result.schema';

import { ProductSearchFiltersSchema } from '@/src/product-consultation/application/search/product-need.schema';

class InvalidPlan extends Error {}

const reject = (message: string): never => {
  throw new InvalidPlan(message);
};

const unique = <T>(items: readonly T[]) => [...new Set(items)];

export const brandKey = (value: string) =>
  value.trim().toLocaleLowerCase('ru-RU');

export const normalizedQuote = (value: string) =>
  value.trim().replace(/\s+/gu, ' ');

function normalizedTokens(value: string): string[] {
  return (
    normalizedQuote(value)
      .toLocaleLowerCase('ru-RU')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function sourceContainsAllTerms(sourceText: string, value: string): boolean {
  const sourceTokens = new Set(normalizedTokens(sourceText));

  const valueTokens = normalizedTokens(value);

  return (
    valueTokens.length > 0 &&
    valueTokens.every((token) => sourceTokens.has(token))
  );
}

function isSupportedNewNeed(
  update: ProductNeedPatch,
  sourceText: string,
): boolean {
  if (update.needIndex !== null) {
    return true;
  }

  if (
    !update.brandValue ||
    !['candidate', 'required', 'preferred'].includes(update.brandMode)
  ) {
    return true;
  }

  return sourceContainsAllTerms(sourceText, update.brandValue);
}

function samePreferences(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const values = new Set(left);

  return right.every((value) => values.has(value));
}

function sameSearchFilters(
  left: ProductNeedMemory['filters'],
  right: ProductNeedMemory['filters'],
): boolean {
  return (
    left.gender === right.gender &&
    left.type === right.type &&
    left.brand === right.brand &&
    left.category === right.category &&
    left.subcategory === right.subcategory &&
    left.color === right.color &&
    left.size === right.size &&
    left.minPrice === right.minPrice &&
    left.maxPrice === right.maxPrice
  );
}

function sameNeedDefinition(
  left: ProductNeedMemory,
  right: ProductNeedMemory,
): boolean {
  return (
    normalizedQuote(left.semanticQuery).toLocaleLowerCase('ru-RU') ===
      normalizedQuote(right.semanticQuery).toLocaleLowerCase('ru-RU') &&
    sameSearchFilters(left.filters, right.filters) &&
    samePreferences(left.preferences, right.preferences)
  );
}

function exists(context: ProductContext, reference: ProductReference) {
  return context.needs.some(
    (need) =>
      need.needId === reference.needId &&
      need.shownProducts.some((product) => product.id === reference.productId),
  );
}

function findProductByReference(
  context: ProductContext,
  reference: ProductReference,
) {
  return context.needs
    .find((need) => need.needId === reference.needId)
    ?.shownProducts.find((product) => product.id === reference.productId);
}

function findUniqueNamedProductReference(
  context: ProductContext,
  references: readonly ProductReference[],
  sourceText: string,
): ProductReference | null {
  const queryTokens = new Set(normalizedTokens(sourceText));

  const matches = references.filter((reference) => {
    const product = findProductByReference(context, reference);

    if (!product) {
      return false;
    }

    const titleTokens = normalizedTokens(product.title).filter(
      (token) => token.length >= 4 || /\d/u.test(token),
    );

    return titleTokens.some((token) => queryTokens.has(token));
  });

  return matches.length === 1 ? matches[0] : null;
}

function findOrdinalPosition(
  sourceText: string,
  itemsCount: number,
): number | null {
  const text = normalizedQuote(sourceText).toLocaleLowerCase('ru-RU');

  const boundary = '[^\\p{L}\\p{N}_]';

  if (
    new RegExp(
      `(?:^|${boundary})перв(?:ый|ого|ому|ым|ом)(?=$|${boundary})`,
      'u',
    ).test(text)
  ) {
    return 1;
  }

  if (
    new RegExp(
      `(?:^|${boundary})втор(?:ой|ого|ому|ым|ом)(?=$|${boundary})`,
      'u',
    ).test(text)
  ) {
    return 2;
  }

  if (
    new RegExp(
      `(?:^|${boundary})трет(?:ий|ьего|ьему|ьим|ьем)(?=$|${boundary})`,
      'u',
    ).test(text)
  ) {
    return 3;
  }

  if (
    new RegExp(
      `(?:^|${boundary})последн(?:ий|его|ему|им|ем)(?=$|${boundary})`,
      'u',
    ).test(text)
  ) {
    return itemsCount;
  }

  return null;
}

const FILTER_PATCH_FIELDS = [
  'gender',
  'type',
  'category',
  'subcategory',
  'color',
  'size',
  'minPrice',
  'maxPrice',
] as const satisfies readonly (keyof ProductFilterPatch)[];

function normalizeFilterValue(
  field: keyof ProductFilterPatch,
  value: string | number | null,
): string | number | null {
  if (value === null) {
    return null;
  }

  if (field === 'size') {
    if (typeof value === 'number') {
      return String(value);
    }

    const normalized = value.trim();

    if (/^\d+,\d+$/u.test(normalized)) {
      return normalized.replace(',', '.');
    }

    return normalized;
  }

  if (field === 'minPrice' || field === 'maxPrice') {
    if (typeof value === 'number') {
      return value;
    }

    const normalized = value.trim().replace(/\s+/gu, '').replace(',', '.');

    const number = Number(normalized);

    return Number.isFinite(number) ? number : value;
  }

  return value;
}

function applyFilterPatch(
  filters: ReturnType<typeof ProductSearchFiltersSchema.parse>,
  patch: ProductFilterPatch,
): void {
  for (const field of FILTER_PATCH_FIELDS) {
    const rawValue = patch[field];

    if (rawValue === undefined) {
      continue;
    }

    const normalizedValue = normalizeFilterValue(field, rawValue);

    const parsed =
      ProductSearchFiltersSchema.shape[field].safeParse(normalizedValue);

    if (!parsed.success) {
      throw new InvalidPlan('Не удалось применить параметры поиска.');
    }

    Object.assign(filters, {
      [field]: parsed.data,
    });
  }
}

function normalizePlanByAction(
  plan: ProductPlannerResult,
): ProductPlannerResult {
  switch (plan.action) {
    case 'SEARCH':
      return {
        ...plan,
        positions: [],
        attributeIds: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'SHOW':
      return {
        ...plan,
        updates: [],
        positions: [],
        attributeIds: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'COMPARE':
      return {
        ...plan,
        updates: [],
        removeNeedIndexes: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'DETAILS':
      return {
        ...plan,
        updates: [],
        removeNeedIndexes: [],
        reuseNeedIndexes: [],
        attributeIds: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'FEEDBACK':
      return {
        ...plan,
        updates: [],
        removeNeedIndexes: [],
        reuseNeedIndexes: [],
        attributeIds: [],
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'CONSULT':
      return {
        ...plan,
        updates: [],
        removeNeedIndexes: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'COMPLETE':
      return {
        ...plan,
        updates: [],
        removeNeedIndexes: [],
        reuseNeedIndexes: [],
        attributeIds: [],
        reaction: null,
        handoffReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'HANDOFF':
      return {
        ...plan,
        updates: [],
        removeNeedIndexes: [],
        reuseNeedIndexes: [],
        attributeIds: [],
        reaction: null,
        completionReason: null,
        question: null,
        clarificationNeedIndex: null,
        clarificationFields: [],
      };

    case 'CLARIFY':
      return {
        ...plan,
        updates: [],
        removeNeedIndexes: [],
        reuseNeedIndexes: [],
        referenceSource: 'active',
        positions: [],
        attributeIds: [],
        reaction: null,
        completionReason: null,
        handoffReason: null,
      };
  }
}

export function applyProductPlan(
  previous: unknown,
  rawPlan: unknown,
  sourceText: string,
  canonicalBrands: ReadonlyMap<string, string | null> = new Map(),
): {
  productContext: ProductContext;
  activeNeedIds: string[];
  searchNeedIds: string[];
  turn: ProductTurn;
  message: string | null;
} {
  const original = readProductContext(previous);

  const fallback = (
    question: string,
    needId: string | null = null,
    fields: NonNullable<ProductContext['pendingClarification']>['fields'] = [],
  ) => {
    const context = readProductContext(original);

    context.pendingClarification = {
      needId,
      kind: 'clarification',
      question,
      fields,
      proposal: null,
    };

    if (context.consultationSession?.status === 'ACTIVE') {
      touchConsultationSession(context, context.consultationSession.needIds);
    }

    return {
      productContext: context,

      activeNeedIds: [],

      searchNeedIds: [],

      turn: {
        action: 'CLARIFY',

        products: [],

        attributeIds: [],

        reaction: null,

        completionReason: null,

        handoffRequest: null,
      } as ProductTurn,

      message: question,
    };
  };

  const parsed = ProductPlannerResultSchema.safeParse(rawPlan);

  if (!parsed.success) {
    return fallback(
      'Уточните, пожалуйста: найти товары или продолжить работу с показанными?',
    );
  }

  const plan = normalizePlanByAction(parsed.data);

  const byIndex = (index: number): ProductNeedMemory =>
    original.needs[index - 1] ??
    reject('Какой из текущих подборов вы имеете в виду?');

  try {
    for (const values of [
      plan.removeNeedIndexes,
      plan.reuseNeedIndexes,
      plan.positions,
      plan.attributeIds,
    ]) {
      if (unique<string | number>(values).length !== values.length) {
        reject('Уточните, какие товары или подборы использовать.');
      }
    }

    if (plan.action === 'CLARIFY') {
      if (!plan.question) {
        reject('Уточните, пожалуйста, что изменить в подборе.');
      }

      return fallback(
        plan.question,

        plan.clarificationNeedIndex === null
          ? null
          : byIndex(plan.clarificationNeedIndex).needId,

        plan.clarificationFields,
      );
    }

    if (plan.action === 'COMPLETE' && plan.completionReason === null) {
      reject('Уточните, вы закончили выбор или хотите продолжить подбор?');
    }

    if (plan.action === 'HANDOFF' && plan.handoffReason === null) {
      reject('Уточните, нужна ли вам помощь оператора?');
    }

    const context = readProductContext(original);

    const removed = new Set(
      plan.removeNeedIndexes.map((index) => byIndex(index).needId),
    );

    context.needs = context.needs.filter((need) => !removed.has(need.needId));

    if (context.consultationSession?.status === 'ACTIVE') {
      context.consultationSession.needIds =
        context.consultationSession.needIds.filter(
          (needId) => !removed.has(needId),
        );
    }

    const searchNeedIds: string[] = [];

    const touched = new Set<string>();

    for (const update of plan.updates) {
      if (!isSupportedNewNeed(update, sourceText)) {
        continue;
      }
      const existing =
        update.needIndex === null ? null : byIndex(update.needIndex);

      const needId = existing?.needId ?? randomUUID();

      if (removed.has(needId) || touched.has(needId)) {
        reject(
          'Один подбор нельзя одновременно удалить и изменить или изменить дважды.',
        );
      }

      touched.add(needId);

      const filters = ProductSearchFiltersSchema.parse(
        existing?.filters ??
          Object.fromEntries(
            Object.keys(ProductSearchFiltersSchema.shape).map((key) => [
              key,
              null,
            ]),
          ),
      );

      applyFilterPatch(filters, update.filterPatch);

      if (
        filters.minPrice !== null &&
        filters.maxPrice !== null &&
        filters.minPrice > filters.maxPrice
      ) {
        reject('Какой диапазон цены использовать?');
      }

      let semanticQuery = update.semanticQuery ?? existing?.semanticQuery;

      if (!semanticQuery) {
        reject('Какой товар нужно найти?');
      }

      let preferences = (existing?.preferences ?? []).filter(
        (value) => !update.removePreferences.includes(value),
      );

      if (
        update.removePreferences.some(
          (value) => !existing?.preferences.includes(value),
        )
      ) {
        reject('Какое из сохранённых пожеланий нужно убрать?');
      }

      preferences = unique([...preferences, ...update.addPreferences]);

      if (update.brandMode !== 'keep') {
        if (
          ['candidate', 'required', 'preferred'].includes(update.brandMode) &&
          !update.brandValue
        ) {
          reject('Какой бренд вы имеете в виду?');
        }

        const canonical = update.brandValue
          ? canonicalBrands.get(brandKey(update.brandValue)) ?? null
          : null;

        if (update.brandMode === 'required') {
          filters.brand = canonical ?? update.brandValue;
        }

        if (update.brandMode === 'candidate') {
          filters.brand = canonical;

          if (
            !canonical &&
            update.brandValue &&
            !brandKey(semanticQuery).includes(brandKey(update.brandValue))
          ) {
            semanticQuery += ` ${update.brandValue}`;
          }
        }

        if (update.brandMode === 'preferred' || update.brandMode === 'clear') {
          const oldBrand = existing?.filters.brand;

          filters.brand = null;

          if (oldBrand) {
            preferences = preferences.filter(
              (value) => !brandKey(value).includes(brandKey(oldBrand)),
            );
          }

          if (update.brandMode === 'preferred' && update.brandSource) {
            preferences.push(update.brandSource);
          }
        }
      }

      preferences = unique(preferences);

      if (preferences.length > 10) {
        reject('Какие пожелания оставить основными?');
      }

      const next: ProductNeedMemory = {
        needId,

        semanticQuery,

        filters,

        preferences,

        shownProducts: existing?.shownProducts ?? [],

        consultation: existing?.consultation ?? emptyConsultationMemory(),
      };

      const changed = !existing || !sameNeedDefinition(existing, next);

      if (existing) {
        context.needs = context.needs.map((need) =>
          need.needId === needId ? next : need,
        );
      } else {
        context.needs.push(next);
      }

      if (changed) {
        searchNeedIds.push(needId);
      }
    }

    if (context.needs.length > 5) {
      const overflow = context.needs.length - 5;

      const protectedNeedIds = new Set(searchNeedIds);

      const evictionCandidates = context.needs.filter(
        (need) => !protectedNeedIds.has(need.needId),
      );

      const evictedNeedIds = new Set(
        evictionCandidates.slice(0, overflow).map((need) => need.needId),
      );

      if (evictedNeedIds.size !== overflow) {
        reject('В одном запросе слишком много независимых товарных задач.');
      }

      context.needs = context.needs.filter(
        (need) => !evictedNeedIds.has(need.needId),
      );

      if (context.consultationSession?.status === 'ACTIVE') {
        context.consultationSession.needIds =
          context.consultationSession.needIds.filter(
            (needId) => !evictedNeedIds.has(needId),
          );
      }
    }

    const reuse = plan.reuseNeedIndexes.map((index) => {
      const need = byIndex(index);

      if (removed.has(need.needId) || touched.has(need.needId)) {
        reject(
          'Подбор нельзя одновременно искать, удалять и переиспользовать.',
        );
      }

      return need.needId;
    });

    if (plan.action === 'SEARCH' && !searchNeedIds.length) {
      searchNeedIds.push(...reuse);

      if (!searchNeedIds.length) {
        reject('Какой подбор нужно обновить?');
      }
    }

    const activeReferenceOrder =
      original.referenceOrder.length > 0
        ? original.referenceOrder
        : original.comparison.length > 0
        ? original.comparison
        : original.displayOrder;

    const source =
      plan.referenceSource === 'active'
        ? activeReferenceOrder
        : plan.referenceSource === 'display'
        ? original.displayOrder
        : original.comparison;

    let products: ProductReference[] = plan.positions.map(
      (position) =>
        source[position - 1] ??
        reject('В текущем наборе нет товара с таким номером.'),
    );

    if (plan.action === 'CONSULT' && products.length === 0) {
      const namedReference = findUniqueNamedProductReference(
        original,
        source,
        sourceText,
      );

      if (namedReference) {
        products = [namedReference];
      } else {
        const ordinalPosition = findOrdinalPosition(sourceText, source.length);

        if (ordinalPosition !== null && source[ordinalPosition - 1]) {
          products = [source[ordinalPosition - 1]];
        }
      }
    }

    if (plan.action === 'COMPARE' && !products.length) {
      products = source.filter(
        (reference) => !reuse.length || reuse.includes(reference.needId),
      );
    }

    if (
      plan.action === 'COMPLETE' &&
      plan.completionReason !== 'PRODUCT_SELECTED'
    ) {
      products = [];
    }

    if (products.some((reference) => !exists(original, reference))) {
      reject(
        'Эти карточки больше не доступны в текущем подборе. Какой подбор показать снова?',
      );
    }

    if (
      unique(
        products.map(
          (reference) => `${reference.needId}:${reference.productId}`,
        ),
      ).length !== products.length
    ) {
      reject('Для действия нужны разные товары.');
    }

    if (plan.action === 'COMPARE') {
      if (products.length < 2) {
        reject(
          'Сейчас показано меньше двух товаров для сравнения. Какой подбор расширить?',
        );
      }

      if (products.length > 4) {
        reject('Какие два–четыре товара сравнить?');
      }

      if (unique(products.map((reference) => reference.needId)).length !== 1) {
        reject(
          'Товары относятся к разным подборам. Какие товары одного подбора сравнить?',
        );
      }
    }

    if (
      ['DETAILS', 'FEEDBACK'].includes(plan.action) &&
      products.length !== 1
    ) {
      reject('Какой именно показанный товар вы имеете в виду?');
    }

    if (plan.action === 'FEEDBACK' && plan.reaction === null) {
      reject('Что именно вам не подходит в этом товаре?');
    }

    if (
      plan.action === 'COMPLETE' &&
      plan.completionReason === 'PRODUCT_SELECTED' &&
      products.length === 0
    ) {
      reject('Какой именно товар вы выбрали?');
    }

    if (
      plan.action === 'COMPLETE' &&
      context.consultationSession?.status !== 'ACTIVE'
    ) {
      reject('Сейчас нет активной товарной консультации для завершения.');
    }

    const terminalNeedIds =
      context.consultationSession?.status === 'ACTIVE'
        ? context.consultationSession.needIds.filter((needId) =>
            context.needs.some((need) => need.needId === needId),
          )
        : [];

    const activeNeedIds =
      plan.action === 'SEARCH'
        ? unique([...searchNeedIds, ...reuse])
        : plan.action === 'SHOW'
        ? removed.size || !reuse.length
          ? context.needs.map((need) => need.needId)
          : reuse
        : plan.action === 'COMPLETE' || plan.action === 'HANDOFF'
        ? unique([
            ...products.map((reference) => reference.needId),
            ...terminalNeedIds,
          ])
        : plan.action === 'CONSULT' && products.length > 0
        ? unique(products.map((reference) => reference.needId))
        : plan.action === 'CONSULT' && products.length > 0
        ? unique(products.map((reference) => reference.needId))
        : unique([...products.map((reference) => reference.needId), ...reuse]);

    if (!activeNeedIds.length && !removed.size && plan.action !== 'HANDOFF') {
      reject('Какой из подборов вы хотите обсудить?');
    }

    for (const needId of activeNeedIds) {
      const need = context.needs.find((item) => item.needId === needId);

      if (!need) {
        continue;
      }

      const attributes = new Set(
        getCategoryProfile(need.filters.type).attributes.map((item) => item.id),
      );

      if (plan.attributeIds.some((id) => !attributes.has(id))) {
        reject('Какие характеристики товаров для вас важны?');
      }
    }

    context.displayOrder = context.displayOrder.filter((reference) =>
      exists(context, reference),
    );

    context.referenceOrder = context.referenceOrder.filter((reference) =>
      exists(context, reference),
    );

    context.comparison = context.comparison.filter(
      (reference) =>
        exists(context, reference) && !searchNeedIds.includes(reference.needId),
    );

    if (context.comparison.length < 2) {
      context.comparison = [];
    }

    if (!context.referenceOrder.length) {
      context.referenceOrder =
        context.comparison.length > 0
          ? [...context.comparison]
          : [...context.displayOrder];
    }

    if (plan.action === 'SEARCH' || plan.action === 'SHOW') {
      context.pendingClarification = null;
    }

    if (
      activeNeedIds.length &&
      !['COMPLETE', 'HANDOFF'].includes(plan.action)
    ) {
      touchConsultationSession(context, activeNeedIds);
    }

    const handoffRequest =
      plan.action === 'HANDOFF' && plan.handoffReason
        ? HandoffRequestSchema.parse({
            reason: plan.handoffReason,

            trigger:
              plan.handoffReason === 'CUSTOMER_REQUEST'
                ? 'EXPLICIT_USER_REQUEST'
                : 'UNSUPPORTED_INTENT',
          })
        : null;

    return {
      productContext: readProductContext(context),

      activeNeedIds,

      searchNeedIds,

      turn: {
        action: plan.action,

        products,

        attributeIds: plan.attributeIds,

        reaction: plan.reaction,

        completionReason: plan.completionReason,

        handoffRequest,
      },

      message: activeNeedIds.length ? null : 'Убрал указанные подборы.',
    };
  } catch (error) {
    if (error instanceof InvalidPlan) {
      return fallback(error.message);
    }

    throw error;
  }
}
