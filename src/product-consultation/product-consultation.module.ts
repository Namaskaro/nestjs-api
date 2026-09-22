import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';

import { PrismaModule } from '../core/prisma/prisma.module';

import { QdrantModule } from '../core/qdrant/qdrant.module';

import { RerankerModule } from '../core/reranker/reranker.module';

import { ProductAgentService } from '@/src/product-consultation/application/agent/product-agent.service';

import { CurrentStoreCatalogService } from '@/src/product-consultation/adapters/current-store/current-store-catalog.service';

import { CurrentStoreProductSearchService } from '@/src/product-consultation/adapters/current-store/current-store-product-search.service';

@Module({
  imports: [AiModule, PrismaModule, QdrantModule, RerankerModule],

  providers: [
    CurrentStoreCatalogService,
    CurrentStoreProductSearchService,
    ProductAgentService,
  ],

  exports: [ProductAgentService],
})
export class ProductConsultationModule {}
