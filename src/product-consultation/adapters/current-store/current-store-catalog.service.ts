import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/src/core/prisma/prisma.service';

import type { ProductNeed } from '@/src/product-consultation/application/search/product-need.schema';

import type { ProductDetails } from '@/src/product-consultation/core/consultation-core.schema';

import {
  buildCurrentStoreBinding,
  type ResolvedStoreCatalog,
} from './current-store.mapping';

import { CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE } from './current-store-hard-filters';

import { toProductDetailsMany } from './current-store-product.adapter';

type Brand = {
  id: string;

  name: string;
};

@Injectable()
export class CurrentStoreCatalogService {
  private readonly exactBrands = new Map<
    string,
    {
      until: number;

      value: Brand | null;
    }
  >();

  constructor(private readonly prismaService: PrismaService) {}

  public async resolveBrandName(value: string): Promise<string | null> {
    return (await this.findExactBrand(value))?.name ?? null;
  }

  public async getConsultationBinding(productNeed: ProductNeed) {
    const {
      brand,

      category,

      subcategory,
    } = productNeed.filters;

    const [brandId, subcategoryId, categoryId] = await Promise.all([
      this.resolveBrandId(brand),

      subcategory
        ? this.resolveSubcategoryId(subcategory)
        : Promise.resolve(null),

      subcategory ? Promise.resolve(null) : this.resolveCategoryId(category),
    ]);

    const resolved: ResolvedStoreCatalog = {
      brandId,

      categoryId,

      subcategoryId,
    };

    return buildCurrentStoreBinding(
      productNeed.filters,

      resolved,
    );
  }

  /**
   * Загружает ProductDetails только
   * для товаров, которые ПРЯМО СЕЙЧАС
   * остаются eligible в current-store.
   *
   * Это важно для:
   *
   * - DETAILS;
   * - COMPARE;
   * - RECOMMEND;
   * - будущих purchase actions.
   *
   * Search snapshot не является
   * гарантией текущего наличия.
   */
  public async getProductDetails(
    productIds: readonly string[],
  ): Promise<ProductDetails[]> {
    const ids = [...new Set(productIds)];

    if (!ids.length) {
      return [];
    }

    if (ids.length > 250) {
      throw new Error(
        'CurrentStoreCatalogService: превышен лимит batch-чтения товаров',
      );
    }

    const rows = await this.prismaService.product.findMany({
      where: {
        id: {
          in: ids,
        },

        /**
         * Server-owned eligibility.
         *
         * Availability не является
         * consultation criterion.
         */
        ...CURRENT_STORE_ELIGIBLE_PRODUCT_WHERE,
      },

      select: {
        id: true,

        title: true,

        description: true,

        price: true,

        discount: true,

        images: true,

        sizes: true,

        color: true,

        gender: true,

        type: true,

        inStock: true,

        stock: true,

        details: true,

        updatedAt: true,

        brand: {
          select: {
            id: true,

            name: true,
          },
        },

        subcategory: {
          select: {
            id: true,

            name: true,

            category: {
              select: {
                id: true,

                name: true,
              },
            },
          },
        },
      },
    });

    const byId = new Map(
      toProductDetailsMany(
        rows,

        new Date().toISOString(),
      ).map((product) => [product.id, product]),
    );

    /**
     * Возвращаем в исходном порядке IDs,
     * но отсутствующие / unavailable
     * товары просто не попадают
     * в eligible details.
     */
    return ids.flatMap((id) => {
      const product = byId.get(id);

      return product ? [product] : [];
    });
  }

  public async resolveCatalogFilters(
    productNeed: ProductNeed,
  ): Promise<ResolvedStoreCatalog | null> {
    const {
      brand,

      category,

      subcategory,
    } = productNeed.filters;

    const [brandId, subcategoryId, categoryId] = await Promise.all([
      this.resolveBrandId(brand),

      subcategory
        ? this.resolveSubcategoryId(subcategory)
        : Promise.resolve(null),

      subcategory ? Promise.resolve(null) : this.resolveCategoryId(category),
    ]);

    if (brand && !brandId) {
      return null;
    }

    if (subcategory && !subcategoryId) {
      return null;
    }

    if (!subcategory && category && !categoryId) {
      return null;
    }

    return {
      brandId,

      categoryId,

      subcategoryId,
    };
  }

  private async findExactBrand(value: string): Promise<Brand | null> {
    const name = value.trim();

    if (!name) {
      return null;
    }

    const key = name.toLocaleLowerCase('ru-RU');

    const now = Date.now();

    const cached = this.exactBrands.get(key);

    if (cached && cached.until > now) {
      return cached.value;
    }

    for (const [cacheKey, entry] of this.exactBrands) {
      if (entry.until <= now) {
        this.exactBrands.delete(cacheKey);
      }
    }

    const result = await this.prismaService.brand.findFirst({
      where: {
        name: {
          equals: name,

          mode: 'insensitive',
        },
      },

      select: {
        id: true,

        name: true,
      },
    });

    while (this.exactBrands.size >= 128) {
      this.exactBrands.delete(this.exactBrands.keys().next().value!);
    }

    this.exactBrands.set(
      key,

      {
        until: Date.now() + 30_000,

        value: result,
      },
    );

    return result;
  }

  private async resolveBrandId(value: string | null): Promise<string | null> {
    if (!value) {
      return null;
    }

    const exact = await this.findExactBrand(value);

    if (exact) {
      return exact.id;
    }

    const candidates = await this.prismaService.brand.findMany({
      where: {
        name: {
          contains: value,

          mode: 'insensitive',
        },
      },

      select: {
        id: true,
      },

      take: 2,
    });

    return candidates.length === 1 ? candidates[0].id : null;
  }

  private async resolveCategoryId(
    value: string | null,
  ): Promise<string | null> {
    if (!value) {
      return null;
    }

    const exact = await this.prismaService.category.findFirst({
      where: {
        name: {
          equals: value,

          mode: 'insensitive',
        },
      },

      select: {
        id: true,
      },
    });

    if (exact) {
      return exact.id;
    }

    const candidates = await this.prismaService.category.findMany({
      where: {
        name: {
          contains: value,

          mode: 'insensitive',
        },
      },

      select: {
        id: true,
      },

      take: 2,
    });

    return candidates.length === 1 ? candidates[0].id : null;
  }

  private async resolveSubcategoryId(value: string): Promise<string | null> {
    const exact = await this.prismaService.subcategory.findFirst({
      where: {
        name: {
          equals: value,

          mode: 'insensitive',
        },
      },

      select: {
        id: true,
      },
    });

    if (exact) {
      return exact.id;
    }

    const candidates = await this.prismaService.subcategory.findMany({
      where: {
        name: {
          contains: value,

          mode: 'insensitive',
        },
      },

      select: {
        id: true,
      },

      take: 2,
    });

    return candidates.length === 1 ? candidates[0].id : null;
  }
}
