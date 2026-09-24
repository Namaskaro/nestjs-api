import { describe, expect, it } from '@jest/globals';

import { resolve } from 'node:path';

import type { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { ProductNeedSchema } from '@/src/product-consultation/application/search/product-need.schema';

import {
  FrozenCurrentProductCatalog,
  loadCurrentProductConsultationFixture,
} from './current-product-consultation.fixture';

const fixturePath = resolve(
  process.cwd(),

  'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
);

function createNeed({
  brand,

  color,

  daily = true,
}: {
  brand: string;

  color: string | null;

  daily?: boolean;
}) {
  return ProductNeedSchema.parse({
    semanticQuery: [
      `мужские кроссовки ${brand}`,

      daily ? 'Пожелания: для повседневной носки' : null,
    ]
      .filter(Boolean)
      .join('\n'),

    filters: {
      gender: 'MAN',

      type: 'SHOES',

      brand,

      category: null,

      subcategory: null,

      color,

      size: null,

      minPrice: null,

      maxPrice: null,
    },
  });
}

async function createFrozenCatalog() {
  const fixture = await loadCurrentProductConsultationFixture(fixturePath);

  return {
    fixture,

    catalog: new FrozenCurrentProductCatalog(fixture),
  };
}

describe('FrozenCurrentProductCatalog', () => {
  it('loads the captured E01 catalog', async () => {
    const { fixture } = await createFrozenCatalog();

    expect(fixture.id).toBe('e01-current-catalog');

    expect(fixture.searches).toHaveLength(4);

    expect(fixture.productDetails.length).toBeGreaterThanOrEqual(5);
  });

  it('returns frozen Nike base results', async () => {
    const { catalog } = await createFrozenCatalog();

    const result = await catalog.searchProducts(
      createNeed({
        brand: 'Nike',

        color: null,

        daily: false,
      }),
    );

    expect(result.products.map((product) => product.title)).toEqual([
      'Nike SB Dunk Low Pro',

      'Nike Mind 002',

      'Kobe Air Force 1 Low',
    ]);
  });

  it('returns zero results for green Nike', async () => {
    const { catalog } = await createFrozenCatalog();

    const result = await catalog.searchProducts(
      createNeed({
        brand: 'Nike',

        color: 'зелёный',
      }),
    );

    expect(result.products).toEqual([]);
  });

  it('returns zero results for green Adidas', async () => {
    const { catalog } = await createFrozenCatalog();

    const result = await catalog.searchProducts(
      createNeed({
        brand: 'Adidas',

        color: 'зелёный',
      }),
    );

    expect(result.products).toEqual([]);
  });

  it('returns frozen Adidas daily results after color is cleared', async () => {
    const { catalog } = await createFrozenCatalog();

    const result = await catalog.searchProducts(
      createNeed({
        brand: 'Adidas',

        color: null,
      }),
    );

    expect(result.products.map((product) => product.title)).toEqual([
      'HANDBALL SPEZIAL SHOES',

      'Campus 00s',
    ]);
  });

  it('does not ignore semanticQuery when filters have one unique fixture match', async () => {
    const { catalog } = await createFrozenCatalog();

    const need = createNeed({
      brand: 'Nike',

      color: null,

      daily: false,
    });

    /**
     * Filters полностью совпадают
     * с captured nike-base.
     *
     * Но semantic query другой.
     *
     * Раньше fixture всё равно
     * возвращал Nike products,
     * потому что filter candidate
     * был всего один.
     */
    need.semanticQuery = 'совершенно другой semantic запрос';

    await expect(catalog.searchProducts(need)).rejects.toThrow(
      'filters совпали, но semanticQuery отсутствует в frozen fixture',
    );
  });

  it('normalizes semanticQuery before matching captured request', async () => {
    const { catalog } = await createFrozenCatalog();

    const need = createNeed({
      brand: 'Nike',

      color: null,

      daily: false,
    });

    need.semanticQuery = '  МУЖСКИЕ   КРОССОВКИ   NIKE  ';

    const result = await catalog.searchProducts(need);

    expect(result.products).toHaveLength(3);
  });

  it('serves product details from fixture', async () => {
    const {
      catalog,

      fixture,
    } = await createFrozenCatalog();

    const ids = fixture.searches
      .flatMap((search) => search.products)
      .slice(
        0,

        2,
      )
      .map((product) => product.id);

    const details = await catalog.getProductDetails(ids);

    expect(details.map((product) => product.id)).toEqual(ids);
  });

  it('resolves known fixture brands without live catalog', async () => {
    const { catalog } = await createFrozenCatalog();

    await expect(catalog.resolveBrandName('adidas')).resolves.toBe('Adidas');

    await expect(catalog.resolveBrandName('NIKE')).resolves.toBe('Nike');
  });

  it('rejects a search absent from the frozen fixture', async () => {
    const { catalog } = await createFrozenCatalog();

    await expect(
      catalog.searchProducts(
        createNeed({
          brand: 'Unknown Brand',

          color: null,
        }),
      ),
    ).rejects.toThrow('запрос отсутствует в frozen fixture');
  });

  it('can replace ProductAgentService catalog methods without touching live service', async () => {
    const { fixture } = await createFrozenCatalog();

    const frozenCatalog = new FrozenCurrentProductCatalog(fixture);

    const liveService = {} as ProductAgentService;

    const service = frozenCatalog.createServiceProxy(liveService);

    const result = await service.searchProducts(
      createNeed({
        brand: 'Adidas',

        color: null,
      }),
    );

    expect(result.products).toHaveLength(2);
  });
});
