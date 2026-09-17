import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '@/src/core/app.module';
import { PrismaService } from '@/src/core/prisma/prisma.service';
import { normalizeSearchFilterValue } from '@/src/shared/utils/normalize-search-filter-value';

import {
  CATEGORY_PROFILES,
  getCategoryProfile,
} from '../agents/product-agent/category-profiles';
import {
  ConsultationCore,
  type ConsultationNeedSnapshot,
} from '../agents/product-agent/consultation-core/consultation-core';
import {
  emptyConsultationMemory,
  type CanonicalRequirement,
  type ProductDetails,
  type ProductFact,
} from '../agents/product-agent/consultation-core/consultation-core.schema';
import { ProductAgentService } from '../agents/product-agent/product-agent.service';
import {
  ProductNeedSchema,
  type ProductNeed,
} from '../agents/product-agent/schemas/product-need.schema';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected=${JSON.stringify(
        expected,
      )}, actual=${JSON.stringify(actual)}`,
    );
  }
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected=${JSON.stringify(
        expected,
      )}, actual=${JSON.stringify(actual)}`,
    );
  }
}

function findFact(product: ProductDetails, attributeId: string): ProductFact {
  const fact = product.attributes.find(
    (item) => item.attributeId === attributeId,
  );

  if (!fact) {
    throw new Error(`Не найден fact ${attributeId} у товара ${product.id}`);
  }

  return fact;
}

function findRequirement(
  requirements: CanonicalRequirement[],
  requirementId: string,
): CanonicalRequirement {
  const requirement = requirements.find(
    (item) => item.requirementId === requirementId,
  );

  if (!requirement) {
    throw new Error(`Не найден requirement ${requirementId}`);
  }

  return requirement;
}

async function bootstrap(): Promise<void> {
  console.log('PRODUCT CONSULTATION BRIDGE DEBUG');
  console.log('Paid LLM calls: 0');
  console.log('Qdrant searches: 0');
  console.log('');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const productAgentService = app.get(ProductAgentService);

    const rows = await prisma.product.findMany({
      where: {
        inStock: true,
        stock: {
          gt: 0,
        },
      },
      take: 100,
      orderBy: {
        createdAt: 'asc',
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

    assert(
      rows.length > 0,
      'В Postgres не найдено ни одного товара inStock=true и stock>0',
    );

    console.log(`✅ Postgres вернул реальные товары: ${rows.length}`);

    const rowsByType = new Map<string, typeof rows>();

    for (const row of rows) {
      const group = rowsByType.get(row.type) ?? [];

      group.push(row);

      rowsByType.set(row.type, group);
    }

    const selectedGroup =
      [...rowsByType.values()].sort(
        (left, right) => right.length - left.length,
      )[0] ?? [];

    assert(selectedGroup.length > 0, 'Не удалось выбрать товары одного типа');

    const selectedRows = selectedGroup.slice(0, 2);

    const selectedIds = selectedRows.map((row) => row.id);

    console.log(`Проверяем profile ${selectedRows[0].type}:`);

    for (const row of selectedRows) {
      console.log(`- ${row.title}`);
    }

    console.log('');

    const products = await productAgentService.getProductDetails(selectedIds);

    assertEqual(
      products.length,
      selectedIds.length,
      'Количество ProductDetails',
    );

    assertDeepEqual(
      products.map((product) => product.id),
      selectedIds,
      'Порядок ProductDetails',
    );

    console.log(
      '✅ ProductAgentService.getProductDetails() вернул товары в исходном порядке',
    );

    for (const product of products) {
      const row = selectedRows.find((item) => item.id === product.id);

      assert(row, `Нет исходной Postgres row для ${product.id}`);

      assertEqual(product.title, row.title, `${row.title}: title`);

      assertEqual(
        product.description,
        row.description,
        `${row.title}: description`,
      );

      assertEqual(product.productType, row.type, `${row.title}: productType`);

      assertEqual(
        product.profileId,
        getCategoryProfile(row.type).id,
        `${row.title}: profileId`,
      );

      assertEqual(product.price, row.price, `${row.title}: header price`);

      assertEqual(product.discount, row.discount, `${row.title}: discount`);

      assertDeepEqual(product.images, row.images, `${row.title}: images`);

      assertEqual(
        product.brand?.id ?? null,
        row.brand?.id ?? null,
        `${row.title}: brand.id`,
      );

      assertEqual(
        product.brand?.name ?? null,
        row.brand?.name ?? null,
        `${row.title}: brand.name`,
      );

      assertEqual(
        product.category?.id ?? null,
        row.subcategory?.category.id ?? null,
        `${row.title}: category.id`,
      );

      assertEqual(
        product.subcategory?.id ?? null,
        row.subcategory?.id ?? null,
        `${row.title}: subcategory.id`,
      );

      assertEqual(
        product.availability.inStock,
        true,
        `${row.title}: availability.inStock`,
      );

      assertEqual(
        product.availability.stock,
        row.stock,
        `${row.title}: availability.stock`,
      );

      const priceFact = findFact(product, 'price');

      assertEqual(priceFact.status, 'known', `${row.title}: price status`);

      assertEqual(
        priceFact.value,
        Number(row.price),
        `${row.title}: price fact`,
      );

      assert(
        priceFact.provenance.length > 0,
        `${row.title}: price fact не содержит provenance`,
      );

      const typeFact = findFact(product, 'type');

      assertEqual(typeFact.status, 'known', `${row.title}: type status`);

      assertEqual(typeFact.value, row.type, `${row.title}: type fact`);

      const genderFact = findFact(product, 'gender');

      assertEqual(genderFact.status, 'known', `${row.title}: gender status`);

      assertEqual(genderFact.value, row.gender, `${row.title}: gender fact`);

      const stockFact = findFact(product, 'stock');

      assertEqual(stockFact.status, 'known', `${row.title}: stock status`);

      assertEqual(stockFact.value, row.stock, `${row.title}: stock fact`);

      const inStockFact = findFact(product, 'inStock');

      assertEqual(inStockFact.status, 'known', `${row.title}: inStock status`);

      assertEqual(inStockFact.value, true, `${row.title}: inStock fact`);

      const colorFact = findFact(product, 'color');

      if (row.color?.trim()) {
        assertEqual(colorFact.status, 'known', `${row.title}: color status`);

        assertEqual(
          colorFact.value,
          normalizeSearchFilterValue(row.color),
          `${row.title}: color fact`,
        );
      } else {
        assertEqual(
          colorFact.status,
          'unknown',
          `${row.title}: empty color status`,
        );
      }

      const sizesFact = findFact(product, 'sizes');

      if (row.sizes.length > 0) {
        assertEqual(sizesFact.status, 'known', `${row.title}: sizes status`);

        assertDeepEqual(
          sizesFact.value,
          [...new Set(row.sizes.map((size) => size.trim()))],
          `${row.title}: sizes fact`,
        );
      } else {
        assertEqual(
          sizesFact.status,
          'unknown',
          `${row.title}: empty sizes status`,
        );
      }

      const brandFact = findFact(product, 'brand');

      if (row.brand) {
        assertEqual(brandFact.status, 'known', `${row.title}: brand status`);

        assertEqual(brandFact.value, row.brand.id, `${row.title}: brand fact`);

        assertEqual(
          brandFact.displayValue,
          row.brand.name,
          `${row.title}: brand displayValue`,
        );
      } else {
        assertEqual(
          brandFact.status,
          'unknown',
          `${row.title}: empty brand status`,
        );
      }

      const categoryFact = findFact(product, 'category');

      if (row.subcategory?.category) {
        assertEqual(
          categoryFact.status,
          'known',
          `${row.title}: category status`,
        );

        assertEqual(
          categoryFact.value,
          row.subcategory.category.id,
          `${row.title}: category fact`,
        );
      } else {
        assertEqual(
          categoryFact.status,
          'unknown',
          `${row.title}: empty category status`,
        );
      }

      const subcategoryFact = findFact(product, 'subcategory');

      if (row.subcategory) {
        assertEqual(
          subcategoryFact.status,
          'known',
          `${row.title}: subcategory status`,
        );

        assertEqual(
          subcategoryFact.value,
          row.subcategory.id,
          `${row.title}: subcategory fact`,
        );
      } else {
        assertEqual(
          subcategoryFact.status,
          'unknown',
          `${row.title}: empty subcategory status`,
        );
      }
    }

    console.log(
      '✅ Current Store Adapter корректно перенёс structured Postgres fields в ProductDetails/ProductFacts',
    );

    const rowWithDetails = rows.find((row) => row.details.length > 0);

    if (rowWithDetails) {
      const [detailsProduct] = await productAgentService.getProductDetails([
        rowWithDetails.id,
      ]);

      assert(detailsProduct, 'Не удалось получить товар с Product.details');

      const structuredAttributeIds = new Set([
        'price',
        'brand',
        'category',
        'subcategory',
        'type',
        'gender',
        'color',
        'sizes',
        'inStock',
        'stock',
      ]);

      const detailFacts = detailsProduct.attributes.filter(
        (fact) =>
          !structuredAttributeIds.has(fact.attributeId) &&
          fact.status === 'known',
      );

      console.log(
        `✅ Product.details обработан adapter'ом: ${rowWithDetails.title}`,
      );

      console.log(
        `   raw details: ${rowWithDetails.details.length}, known canonical detail facts: ${detailFacts.length}`,
      );
    } else {
      console.log(
        'ℹ️ В текущих товарах нет заполненного Product.details — этот участок bridge сейчас нечем проверить на реальных данных',
      );
    }

    const anchorRow = selectedRows[0];

    const anchorPrice = Number(anchorRow.price);

    assert(
      Number.isFinite(anchorPrice),
      `Некорректная цена товара ${anchorRow.title}`,
    );

    const productNeed: ProductNeed = ProductNeedSchema.parse({
      semanticQuery: anchorRow.title,

      filters: {
        gender: anchorRow.gender,

        type: anchorRow.type,

        brand: anchorRow.brand?.name ?? null,

        category: null,

        subcategory: anchorRow.subcategory?.name ?? null,

        color: anchorRow.color?.trim() ? anchorRow.color : null,

        size: anchorRow.sizes[0] ?? null,

        minPrice: null,

        maxPrice: Math.ceil(anchorPrice),
      },
    });

    const binding = await productAgentService.getConsultationBinding(
      productNeed,
    );

    assertEqual(
      binding.profileId,
      getCategoryProfile(anchorRow.type).id,
      'binding.profileId',
    );

    const inStockRequirement = findRequirement(
      binding.requirements,
      'filter:inStock',
    );

    assertEqual(
      inStockRequirement.resolution,
      'resolved',
      'inStock requirement resolution',
    );

    assertEqual(inStockRequirement.value, true, 'inStock requirement value');

    const typeRequirement = findRequirement(
      binding.requirements,
      'filter:type',
    );

    assertEqual(
      typeRequirement.value,
      anchorRow.type,
      'type requirement value',
    );

    if (anchorRow.brand) {
      const brandRequirement = findRequirement(
        binding.requirements,
        'filter:brand',
      );

      assertEqual(
        brandRequirement.resolution,
        'resolved',
        'brand requirement resolution',
      );

      assertEqual(
        brandRequirement.value,
        anchorRow.brand.id,
        'brand requirement canonical value',
      );
    }

    if (anchorRow.subcategory) {
      const subcategoryRequirement = findRequirement(
        binding.requirements,
        'filter:subcategory',
      );

      assertEqual(
        subcategoryRequirement.resolution,
        'resolved',
        'subcategory requirement resolution',
      );

      assertEqual(
        subcategoryRequirement.value,
        anchorRow.subcategory.id,
        'subcategory requirement canonical value',
      );
    }

    if (anchorRow.color?.trim()) {
      const colorRequirement = findRequirement(
        binding.requirements,
        'filter:color',
      );

      assertEqual(
        colorRequirement.value,
        normalizeSearchFilterValue(anchorRow.color),
        'color requirement canonical value',
      );
    }

    if (anchorRow.sizes[0]) {
      const sizeRequirement = findRequirement(
        binding.requirements,
        'filter:size',
      );

      assertEqual(
        sizeRequirement.operator,
        'contains',
        'size requirement operator',
      );

      assertEqual(
        sizeRequirement.value,
        anchorRow.sizes[0],
        'size requirement value',
      );
    }

    const maxPriceRequirement = findRequirement(
      binding.requirements,
      'filter:maxPrice',
    );

    assertEqual(
      maxPriceRequirement.operator,
      'lte',
      'maxPrice requirement operator',
    );

    assertEqual(
      maxPriceRequirement.value,
      Math.ceil(anchorPrice),
      'maxPrice requirement value',
    );

    console.log(
      '✅ getConsultationBinding() построил resolved canonical requirements из реального ProductNeed',
    );

    const unresolvedNeed = ProductNeedSchema.parse({
      semanticQuery: anchorRow.title,

      filters: {
        gender: null,
        type: anchorRow.type,
        brand: '__bridge_nonexistent_brand_9f7c2a__',
        category: null,
        subcategory: null,
        color: null,
        size: null,
        minPrice: null,
        maxPrice: null,
      },
    });

    const unresolvedBinding = await productAgentService.getConsultationBinding(
      unresolvedNeed,
    );

    const unresolvedBrand = findRequirement(
      unresolvedBinding.requirements,
      'filter:brand',
    );

    assertEqual(
      unresolvedBrand.resolution,
      'unresolved',
      'unknown brand resolution',
    );

    assertEqual(unresolvedBrand.value, null, 'unknown brand canonical value');

    console.log(
      '✅ Неизвестный catalog filter не выдумывает canonical ID и становится unresolved',
    );

    const coreProductIds = selectedRows.map((row) => row.id);

    const coreProducts = products.filter((product) =>
      coreProductIds.includes(product.id),
    );

    const snapshot: ConsultationNeedSnapshot = {
      needId: 'bridge-need',

      query: productNeed.semanticQuery,

      preferences: ['bridge deterministic check'],

      profileId: binding.profileId,

      memory: emptyConsultationMemory(),

      requirements: binding.requirements,

      allowedProductIds: [...coreProductIds],

      displayedProductIds: [...coreProductIds],

      comparisonProductIds:
        coreProductIds.length > 1 ? [...coreProductIds] : [],
    };

    const core = new ConsultationCore({
      needs: [snapshot],

      products: coreProducts,

      profiles: CATEGORY_PROFILES,

      budget: {
        toolCallsPerTurn: 16,
        comparisonsPerTurn: 4,
      },
    });

    const initial = core.initialView('bridge-need');

    assertEqual(initial.needId, 'bridge-need', 'core initial needId');

    assertEqual(initial.profile.id, binding.profileId, 'core initial profile');

    assertEqual(initial.memoryRevision, 0, 'core initial revision');

    assert(
      initial.products.length > 0,
      'Core не получил ни одного ProductFacts',
    );

    assert(
      initial.products.every((product) => product.found),
      'Core считает загруженный товар отсутствующим',
    );

    console.log('✅ Реальные ProductDetails успешно приняты ConsultationCore');

    const detailResult = core.getProductDetails({
      needId: 'bridge-need',

      productIds: [anchorRow.id],

      attributeIds: [
        'price',
        'brand',
        'type',
        'gender',
        'color',
        'sizes',
        'inStock',
        'stock',
      ],

      presentation: 'facts',
    });

    assertEqual(
      detailResult.products.length,
      1,
      'Core getProductDetails length',
    );

    assertEqual(
      detailResult.products[0]?.productId,
      anchorRow.id,
      'Core getProductDetails productId',
    );

    const corePriceFact = detailResult.products[0]?.facts.find(
      (fact) => fact.attributeId === 'price',
    );

    assert(corePriceFact, 'Core не вернул price fact');

    assertEqual(corePriceFact.status, 'known', 'Core price fact status');

    assertEqual(corePriceFact.value, anchorPrice, 'Core price fact value');

    console.log(
      '✅ ConsultationCore отдаёт LLM-проекцию реальных authoritative facts',
    );

    if (coreProductIds.length > 1) {
      const comparison = core.compareProducts({
        needId: 'bridge-need',

        expectedRevision: 0,

        productIds: coreProductIds,

        attributeIds: ['price', 'color', 'sizes', 'stock'],
      });

      assertEqual(
        comparison.productIds.length,
        coreProductIds.length,
        'comparison product count',
      );

      assert(
        comparison.rows.some((row) => row.attributeId === 'price'),
        'Comparison не содержит price row',
      );

      const artifacts = core.artifacts([comparison.comparisonId]);

      assertEqual(artifacts.comparisons.length, 1, 'comparison artifact count');

      console.log(
        '✅ ConsultationCore построил deterministic comparison по реальным товарам',
      );
    } else {
      console.log(
        'ℹ️ В базе нашёлся только один товар выбранного типа — comparison пропущен',
      );
    }

    core.seal();

    const memories = core.committedMemories();

    assertEqual(memories.length, 1, 'committed memories count');

    console.log(
      '✅ ConsultationCore завершил bridge lifecycle и отдал persistent memory',
    );

    console.log('');
    console.log('✅ PRODUCT CONSULTATION BRIDGE DEBUG PASSED');
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  console.error('');
  console.error('❌ PRODUCT CONSULTATION BRIDGE DEBUG FAILED');

  console.error(error instanceof Error ? error.message : error);

  process.exitCode = 1;
});
