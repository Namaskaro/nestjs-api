import { randomUUID } from 'node:crypto';

import {
  readProductContext,
  type ProductContext,
  type ProductNeedMemory,
  type ProductReference,
} from '../../schemas/product-context.schema';
import { getCategoryProfile } from './category-profiles';
import { emptyConsultationMemory } from './consultation-core/consultation-core.schema';
import type { ProductTurn } from './product-agent.state';
import {
  ProductPlannerResultSchema,
  type ProductFilterPatch,
  type ProductPlannerResult,
} from './schemas/product-planner-result.schema';
import { ProductSearchFiltersSchema } from './schemas/product-need.schema';

class InvalidPlan extends Error {}

const reject = (message: string): never => {
  throw new InvalidPlan(message);
};

const unique = <T>(items: readonly T[]) => [...new Set(items)];

export const brandKey = (value: string) =>
  value.trim().toLocaleLowerCase('ru-RU');

export const normalizedQuote = (value: string) =>
  value.trim().replace(/\s+/gu, ' ');

function exists(context: ProductContext, reference: ProductReference) {
  return context.needs.some(
    (need) =>
      need.needId === reference.needId &&
      need.shownProducts.some((product) => product.id === reference.productId),
  );
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

// ===== START CHANGE: ACTION OWNS PLAN FIELDS =====

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
        referenceSource: 'display',
        positions: [],
        attributeIds: [],
        reaction: null,
      };
  }
}

// ===== END CHANGE: ACTION OWNS PLAN FIELDS =====

export function applyProductPlan(
  previous: unknown,
  rawPlan: unknown,
  _sourceText: string,
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
    fields: ProductContext['pendingClarification']['fields'] = [],
  ) => {
    const context = readProductContext(original);

    context.pendingClarification = {
      needId,
      kind: 'clarification',
      question,
      fields,
      proposal: null,
    };

    return {
      productContext: context,
      activeNeedIds: [],
      searchNeedIds: [],
      turn: {
        action: 'CLARIFY',
        products: [],
        attributeIds: [],
        reaction: null,
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

  // ===== START CHANGE: NORMALIZE BY ACTION =====

  const plan = normalizePlanByAction(parsed.data);

  // ===== END CHANGE: NORMALIZE BY ACTION =====

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

    const context = readProductContext(original);

    const removed = new Set(
      plan.removeNeedIndexes.map((index) => byIndex(index).needId),
    );

    context.needs = context.needs.filter((need) => !removed.has(need.needId));

    const searchNeedIds: string[] = [];
    const touched = new Set<string>();

    for (const update of plan.updates) {
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

      if (existing) {
        context.needs = context.needs.map((need) =>
          need.needId === needId ? next : need,
        );
      } else {
        context.needs.push(next);
      }

      searchNeedIds.push(needId);
    }

    if (context.needs.length > 5) {
      reject('Какой из прежних подборов убрать? Одновременно доступны пять.');
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

    const source =
      plan.referenceSource === 'display'
        ? original.displayOrder
        : original.comparison;

    let products: ProductReference[] = plan.positions.map(
      (position) =>
        source[position - 1] ??
        reject('В текущей выдаче нет товара с таким номером.'),
    );

    if (plan.action === 'COMPARE' && !products.length) {
      products = source.filter(
        (reference) => !reuse.length || reuse.includes(reference.needId),
      );
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
      reject('Для сравнения нужны разные товары.');
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

    const activeNeedIds =
      plan.action === 'SEARCH'
        ? unique([...searchNeedIds, ...reuse])
        : plan.action === 'SHOW'
        ? removed.size || !reuse.length
          ? context.needs.map((need) => need.needId)
          : reuse
        : unique([...products.map((reference) => reference.needId), ...reuse]);

    if (!activeNeedIds.length && !removed.size) {
      reject('Какой из подборов вы хотите обсудить?');
    }

    for (const needId of activeNeedIds) {
      const need = context.needs.find((item) => item.needId === needId)!;

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

    context.comparison = context.comparison.filter(
      (reference) =>
        exists(context, reference) && !searchNeedIds.includes(reference.needId),
    );

    if (context.comparison.length < 2) {
      context.comparison = [];
    }

    if (plan.action === 'SEARCH' || plan.action === 'SHOW') {
      context.pendingClarification = null;
    }

    return {
      productContext: readProductContext(context),

      activeNeedIds,

      searchNeedIds,

      turn: {
        action: plan.action,
        products,
        attributeIds: plan.attributeIds,
        reaction: plan.reaction,
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
