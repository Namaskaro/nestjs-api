import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AiService } from '@/src/ai/ai.service';
import { AppModule } from '@/src/core/app.module';
import { PrismaService } from '@/src/core/prisma/prisma.service';

import {
  CATEGORY_PROFILES,
  getCategoryProfile,
} from '../agents/product-agent/category-profiles';

import {
  ConsultationCore,
  type ConsultationNeedSnapshot,
} from '../agents/product-agent/consultation-core/consultation-core';

import { emptyConsultationMemory } from '../agents/product-agent/consultation-core/consultation-core.schema';

import {
  buildComparisonMessage,
  finalizeComparisonPresentation,
  prepareComparisonPresentation,
} from '../agents/product-agent/product-turn/comparison-presentation';

import { ProductAgentService } from '../agents/product-agent/product-agent.service';

import { ProductNeedSchema } from '../agents/product-agent/schemas/product-need.schema';

import { createComparisonSynthesis } from '../agents/product-agent/subagents/consultation-agent/comparison-synthesis';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function bootstrap(): Promise<void> {
  const runLlm = process.env.RUN_COMPARISON_SYNTHESIS_LLM === '1';

  console.log('PRODUCT COMPARISON PRESENTATION DEBUG');

  console.log(`Paid LLM calls: ${runLlm ? 'ENABLED (max 1 Lite call)' : '0'}`);

  console.log('Qdrant searches: 0');

  console.log('');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);

    const productAgentService = app.get(ProductAgentService);

    const aiService = app.get(AiService);

    const rows = await prisma.product.findMany({
      where: {
        inStock: true,

        stock: {
          gt: 0,
        },

        type: 'CLOTHES',

        subcategory: {
          name: 'Костюмы',
        },
      },

      orderBy: {
        createdAt: 'asc',
      },

      take: 2,

      select: {
        id: true,

        title: true,
      },
    });

    assert(
      rows.length === 2,
      'Для debug нужны минимум два костюма inStock=true и stock>0.',
    );

    const productIds = rows.map((row) => row.id);

    console.log('Проверяем товары:');

    for (const row of rows) {
      console.log(`- ${row.title}`);
    }

    console.log('');

    const products = await productAgentService.getProductDetails(productIds);

    assert(
      products.length === 2,
      'getProductDetails должен вернуть два товара.',
    );

    assert(
      products[0].id === productIds[0] && products[1].id === productIds[1],
      'getProductDetails должен сохранить порядок productIds.',
    );

    console.log('✅ ProductDetails загружены из Postgres в правильном порядке');

    const productNeed = ProductNeedSchema.parse({
      semanticQuery: 'костюм на свадьбу',

      filters: {
        gender: null,

        type: 'CLOTHES',

        brand: null,

        category: null,

        subcategory: 'Костюмы',

        color: null,

        size: null,

        minPrice: null,

        maxPrice: null,
      },
    });

    const binding = await productAgentService.getConsultationBinding(
      productNeed,
    );

    const needId = 'debug-suit-comparison';

    const memory = emptyConsultationMemory();

    const snapshot: ConsultationNeedSnapshot = {
      needId,

      query: productNeed.semanticQuery,

      preferences: [],

      profileId: binding.profileId,

      memory,

      requirements: binding.requirements,

      allowedProductIds: productIds,

      displayedProductIds: productIds,

      comparisonProductIds: productIds,
    };

    const core = new ConsultationCore({
      needs: [snapshot],

      products,

      profiles: CATEGORY_PROFILES,
    });

    const comparisonView = core.compareProducts({
      needId,

      expectedRevision: core.referenceOptions(needId).memoryRevision,

      productIds,

      attributeIds: null,
    });

    console.log('✅ ConsultationCore построил verified comparison');

    core.getProductDetails({
      needId,

      productIds,

      attributeIds: null,

      presentation: 'details',
    });

    const artifacts = core.currentArtifacts();

    const comparison = artifacts.comparisons.find(
      (item) => item.comparisonId === comparisonView.comparisonId,
    );

    assert(comparison, 'Comparison artifact не найден.');

    assert(
      artifacts.productDetails.length >= 2,
      'Core должен подготовить ProductDetails artifacts для сравниваемых товаров.',
    );

    console.log(
      '✅ Core подготовил ProductDetails artifacts для будущих карточек UI',
    );

    const need = {
      needId,

      semanticQuery: productNeed.semanticQuery,

      filters: productNeed.filters,

      preferences: [],

      shownProducts: [],

      consultation: memory,
    };

    const profile = getCategoryProfile('CLOTHES');

    const prepared = prepareComparisonPresentation({
      comparison,

      products,

      need,

      profile,

      currentQuery: 'Сравни первые два',

      requestedAttributeIds: [],
    });

    const visibleIds = new Set(prepared.rows.map((row) => row.attributeId));

    const forbiddenIds = [
      'inStock',
      'stock',
      'type',
      'category',
      'subcategory',
      'gender',
    ];

    for (const attributeId of forbiddenIds) {
      assert(
        !visibleIds.has(attributeId),
        `Presentation не должен показывать ${attributeId}.`,
      );
    }

    assert(
      prepared.rows.every((row) =>
        row.cells.some((cell) => cell.status === 'known'),
      ),
      'Presentation не должен содержать строки unknown/unknown.',
    );

    console.log('✅ Presentation скрывает служебные характеристики');

    console.log('✅ Presentation не показывает unknown/unknown');

    const deterministicPresentation = finalizeComparisonPresentation(
      prepared,
      null,
    );

    const deterministicMessage = buildComparisonMessage(
      deterministicPresentation,
    );

    assert(
      deterministicPresentation.products.length === 2,
      'Presentation должен содержать две карточки товара.',
    );

    assert(
      deterministicPresentation.recommendation.length > 0,
      'Deterministic fallback должен иметь recommendation.',
    );

    assert(
      !deterministicMessage.includes('CLOTHES'),
      'Сообщение не должно показывать служебный type=CLOTHES.',
    );

    assert(
      !deterministicMessage.includes('В наличии: true'),
      'Сообщение не должно показывать технический inStock.',
    );

    console.log('✅ Deterministic fallback работает без LLM');

    console.log('');
    console.log('DETERMINISTIC RESULT:');
    console.log('');
    console.log(deterministicMessage);

    if (runLlm) {
      console.log('');
      console.log('PRODUCT COMPARISON LITE LLM SMOKE');
      console.log('');

      const synthesis = createComparisonSynthesis(aiService);

      const result = await synthesis.summarizeComparison(
        prepared.synthesisInput,
      );

      assert(result, 'Lite synthesis вернул null.');

      const presentation = finalizeComparisonPresentation(prepared, result);

      const message = buildComparisonMessage(presentation);

      console.log('✅ Lite synthesis вернул валидный результат');

      console.log('');
      console.log('LLM RESULT:');
      console.log('');
      console.log(message);
    } else {
      console.log('');
      console.log('ℹ️ Lite LLM smoke пропущен.');

      console.log(
        'Для одного платного вызова установи RUN_COMPARISON_SYNTHESIS_LLM=1.',
      );
    }

    console.log('');
    console.log('✅ PRODUCT COMPARISON PRESENTATION DEBUG PASSED');
  } finally {
    await app.close();
  }
}

bootstrap().catch((error) => {
  console.error('');
  console.error('❌ PRODUCT COMPARISON PRESENTATION DEBUG FAILED');

  console.error(error);

  process.exitCode = 1;
});
