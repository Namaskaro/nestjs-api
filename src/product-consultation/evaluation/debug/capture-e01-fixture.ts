import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';

import { dirname, resolve } from 'node:path';

import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';

import { NestFactory } from '@nestjs/core';

import { ProductConsultationModule } from '@/src/product-consultation/product-consultation.module';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import {
  ProductNeedSchema,
  type ProductNeed,
} from '@/src/product-consultation/application/search/product-need.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    ProductConsultationModule,
  ],
})
class EvaluationCaptureModule {}

type CaptureSearch = {
  key: string;

  request: ProductNeed;
};

function createNeed({
  semanticQuery,
  brand,
  color,
}: {
  semanticQuery: string;

  brand: string;

  color: string | null;
}): ProductNeed {
  return ProductNeedSchema.parse({
    semanticQuery,

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

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    EvaluationCaptureModule,
    {
      logger: ['error', 'warn'],
    },
  );

  try {
    const productAgentService = app.get(ProductAgentService);

    const searches: CaptureSearch[] = [
      {
        key: 'nike-base',

        request: createNeed({
          semanticQuery: 'мужские кроссовки Nike',

          brand: 'Nike',

          color: null,
        }),
      },

      {
        key: 'nike-green-daily',

        request: createNeed({
          semanticQuery:
            'мужские кроссовки Nike\nПожелания: для повседневной носки',

          brand: 'Nike',

          color: 'зелёный',
        }),
      },

      {
        key: 'adidas-green-daily',

        request: createNeed({
          semanticQuery:
            'мужские кроссовки Adidas\nПожелания: для повседневной носки',

          brand: 'Adidas',

          color: 'зелёный',
        }),
      },

      {
        key: 'adidas-daily',

        request: createNeed({
          semanticQuery:
            'мужские кроссовки Adidas\nПожелания: для повседневной носки',

          brand: 'Adidas',

          color: null,
        }),
      },
    ];

    const capturedSearches = [];

    const productIds = new Set<string>();

    for (const search of searches) {
      const result = await productAgentService.searchProducts(search.request);

      for (const product of result.products) {
        productIds.add(product.id);
      }

      const consultationBinding =
        await productAgentService.getConsultationBinding(search.request);

      capturedSearches.push({
        key: search.key,

        request: search.request,

        products: result.products,

        consultationBinding,
      });
    }

    const productDetails = await productAgentService.getProductDetails([
      ...productIds,
    ]);

    const capture = {
      id: 'e01-current-catalog',

      capturedAt: new Date().toISOString(),

      searches: capturedSearches,

      productDetails,
    };

    const outputPath = resolve(
      process.cwd(),

      'src/product-consultation/evaluation/fixtures/captured/e01-current-catalog.json',
    );

    await mkdir(dirname(outputPath), {
      recursive: true,
    });

    await writeFile(
      outputPath,

      JSON.stringify(capture, null, 2),

      'utf8',
    );

    console.log('');
    console.log('========== E01 FIXTURE CAPTURE ==========');

    console.log(`Saved: ${outputPath}`);

    console.log('');

    for (const search of capturedSearches) {
      console.log(`${search.key}: ${search.products.length} products`);

      for (const product of search.products) {
        console.log(`  - ${product.title} | ${product.price} | ${product.id}`);
      }
    }

    console.log('');

    console.log(`Unique products: ${productIds.size}`);

    console.log(`Product details: ${productDetails.length}`);

    console.log('=========================================');

    console.log('');
  } finally {
    await app.close();
  }
}

void main();
