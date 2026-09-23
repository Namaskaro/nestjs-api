import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import {
  ProductNeedSchema,
  type ProductNeed,
} from '@/src/product-consultation/application/search/product-need.schema';

import {
  ProductSearchResultSchema,
  type ProductSearchResult,
} from '@/src/product-consultation/application/search/product-search-results.schema';

import { ProductItemSchema } from '@/src/product-consultation/application/agent/product-agent-result.schema';

import {
  CanonicalRequirementSchema,
  ProductDetailsSchema,
  type ProductDetails,
} from '@/src/product-consultation/core/consultation-core.schema';

const CapturedSearchSchema = z.object({
  key: z.string().trim().min(1),

  request: ProductNeedSchema,

  products: z.array(ProductItemSchema),

  consultationBinding: z.object({
    profileId: z.string().trim().min(1),

    requirements: z.array(CanonicalRequirementSchema),
  }),
});

export const CurrentProductConsultationFixtureSchema = z.object({
  id: z.string().trim().min(1),

  capturedAt: z.string().datetime(),

  searches: z.array(CapturedSearchSchema).min(1),

  productDetails: z.array(ProductDetailsSchema),
});

export type CurrentProductConsultationFixture = z.infer<
  typeof CurrentProductConsultationFixtureSchema
>;

function sameFilters(
  left: ProductNeed['filters'],
  right: ProductNeed['filters'],
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

function normalizeQuery(value: string): string {
  return value
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');
}

export async function loadCurrentProductConsultationFixture(
  filePath: string,
): Promise<CurrentProductConsultationFixture> {
  const raw = await readFile(filePath, 'utf8');

  const json = JSON.parse(raw) as unknown;

  return CurrentProductConsultationFixtureSchema.parse(json);
}

export class FrozenCurrentProductCatalog {
  private readonly detailsById: ReadonlyMap<string, ProductDetails>;

  constructor(private readonly fixture: CurrentProductConsultationFixture) {
    this.detailsById = new Map(
      fixture.productDetails.map((product) => [product.id, product]),
    );
  }

  createServiceProxy(liveService: ProductAgentService): ProductAgentService {
    return new Proxy(liveService, {
      get: (target, property, receiver) => {
        if (property === 'searchProducts') {
          return (productNeed: ProductNeed) => this.searchProducts(productNeed);
        }

        if (property === 'getProductDetails') {
          return (productIds: readonly string[]) =>
            this.getProductDetails(productIds);
        }

        if (property === 'getConsultationBinding') {
          return (productNeed: ProductNeed) =>
            this.getConsultationBinding(productNeed);
        }

        if (property === 'resolveBrandName') {
          return (value: string) => this.resolveBrandName(value);
        }

        const original = Reflect.get(target, property, receiver);

        return typeof original === 'function'
          ? original.bind(target)
          : original;
      },
    });
  }

  async searchProducts(rawNeed: ProductNeed): Promise<ProductSearchResult> {
    const productNeed = ProductNeedSchema.parse(rawNeed);

    const captured = this.findSearch(productNeed);

    return ProductSearchResultSchema.parse({
      /**
       * Возвращаем именно текущий запрос агента,
       * а товары — из frozen fixture.
       *
       * Так harness видит, какие constraints
       * реально сформировал агент.
       */
      productNeed,

      products: captured.products,
    });
  }

  async getProductDetails(
    productIds: readonly string[],
  ): Promise<ProductDetails[]> {
    return [...new Set(productIds)].flatMap((productId) => {
      const product = this.detailsById.get(productId);

      return product ? [product] : [];
    });
  }

  async getConsultationBinding(rawNeed: ProductNeed) {
    const productNeed = ProductNeedSchema.parse(rawNeed);

    return this.findSearch(productNeed).consultationBinding;
  }

  async resolveBrandName(value: string): Promise<string | null> {
    const normalized = normalizeQuery(value);

    const brands = new Set(
      this.fixture.searches.flatMap((search) =>
        search.request.filters.brand ? [search.request.filters.brand] : [],
      ),
    );

    for (const brand of brands) {
      if (normalizeQuery(brand) === normalized) {
        return brand;
      }
    }

    return null;
  }

  private findSearch(productNeed: ProductNeed) {
    const candidates = this.fixture.searches.filter((search) =>
      sameFilters(search.request.filters, productNeed.filters),
    );

    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1) {
      const query = normalizeQuery(productNeed.semanticQuery);

      const exact = candidates.find(
        (search) => normalizeQuery(search.request.semanticQuery) === query,
      );

      if (exact) {
        return exact;
      }

      throw new Error(
        'FrozenCurrentProductCatalog: несколько fixture search совпали по constraints.',
      );
    }

    throw new Error(
      [
        'FrozenCurrentProductCatalog: запрос отсутствует в frozen fixture.',
        JSON.stringify({
          semanticQuery: productNeed.semanticQuery,

          filters: productNeed.filters,
        }),
      ].join(' '),
    );
  }
}
